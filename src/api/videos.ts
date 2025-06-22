import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";
import { unlink } from "fs/promises";
import path from "path";
import os from "os";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30; // 1GB
  
  // Extract videoID from URL parameters
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  // Authenticate user
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video for video", videoId, "by user", userID);

  // Get video metadata from database
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }

  // Check if user owns the video
  if (video.userID !== userID) {
    throw new UserForbiddenError("You are not authorized to upload videos for this video");
  }

  // Parse uploaded video file from form data
  const formData = await req.formData();
  const videoFile = formData.get("video");
  if (!(videoFile instanceof File)) {
    throw new BadRequestError("Invalid video file");
  }

  // Check file size limit
  if (videoFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size exceeds 1GB limit");
  }

  // Validate file type
  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only MP4 videos are allowed");
  }

  // Create temporary file
  const tempDir = os.tmpdir();
  const tempFileName = `video_${randomBytes(16).toString("hex")}.mp4`;
  const tempFilePath = path.join(tempDir, tempFileName);
  
  let s3Key: string;
  try {
    // Save to temporary file
    const videoBuffer = await videoFile.arrayBuffer();
    await Bun.write(tempFilePath, new Uint8Array(videoBuffer));

    // Generate S3 key with random 32-byte hex format
    const randomKey = randomBytes(32).toString("hex");
    s3Key = `${randomKey}.mp4`;

    // Upload to S3
    await cfg.s3Client.file(cfg.s3Bucket, s3Key, Bun.file(tempFilePath), {
      "Content-Type": videoFile.type,
    });

    // Update video record with S3 URL
    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
    const updatedVideo = {
      ...video,
      videoURL: videoURL,
    };

    updateVideo(cfg.db, updatedVideo);

    return respondWithJSON(200, updatedVideo);
  } finally {
    // Clean up temporary file
    try {
      await unlink(tempFilePath);
    } catch (err) {
      console.warn("Failed to clean up temporary file:", tempFilePath, err);
    }
  }
}
