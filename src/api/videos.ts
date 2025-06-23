import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

async function getVideoAspectRatio(filePath: string): Promise<string> {
  try {
    const result = Bun.spawn([
      "ffprobe",
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      filePath
    ], {
      stdout: "pipe",
      stderr: "pipe"
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();
    const exitCode = await result.exited;

    if (exitCode !== 0) {
      console.error("ffprobe error:", stderr);
      throw new Error(`ffprobe failed with exit code ${exitCode}: ${stderr}`);
    }

    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find((stream: any) => stream.codec_type === "video");
    
    if (!videoStream || !videoStream.width || !videoStream.height) {
      throw new Error("Could not extract video dimensions");
    }

    const width = videoStream.width;
    const height = videoStream.height;
    const ratio = width / height;

    // Check for landscape (16:9 ≈ 1.78) with tolerance
    if (Math.abs(ratio - (16/9)) < 0.1) {
      return "landscape";
    }
    // Check for portrait (9:16 ≈ 0.56) with tolerance
    if (Math.abs(ratio - (9/16)) < 0.1) {
      return "portrait";
    }
    
    return "other";
  } catch (error) {
    console.error("Error getting video aspect ratio:", error);
    throw new Error("Failed to analyze video aspect ratio");
  }
}

export async function handlerServeVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  // Get video metadata from database
  const video = getVideo(cfg.db, videoId);
  if (!video || !video.videoURL) {
    throw new NotFoundError("Video not found");
  }

  // Extract S3 key from the stored video URL
  const s3Key = video.videoURL.split('/').pop();
  if (!s3Key) {
    throw new BadRequestError("Invalid video URL");
  }

  try {
    // Get video from S3
    const s3File = cfg.s3Client.file(s3Key);
    const videoExists = await s3File.exists();
    
    if (!videoExists) {
      throw new NotFoundError("Video file not found in storage");
    }

    // Handle Range requests for video streaming
    const range = req.headers.get('range');
    const videoFile = await s3File.arrayBuffer();
    const videoSize = videoFile.byteLength;

    if (range) {
      // Parse range header (e.g., "bytes=0-200")
      const ranges = range.replace(/bytes=/, "").split("-");
      const start = parseInt(ranges[0], 10);
      const end = ranges[1] ? parseInt(ranges[1], 10) : videoSize - 1;
      
      const chunkSize = (end - start) + 1;
      const videoChunk = videoFile.slice(start, end + 1);

      return new Response(videoChunk, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': 'video/mp4',
        },
      });
    } else {
      // Serve full video
      return new Response(videoFile, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoSize.toString(),
          'Accept-Ranges': 'bytes',
        },
      });
    }
  } catch (error) {
    console.error("Error serving video:", error);
    throw new BadRequestError("Failed to serve video");
  }
}

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

  // Create temporary file for aspect ratio analysis
  const tempFileName = `temp_${randomBytes(16).toString("hex")}.mp4`;
  const tempFilePath = path.join(tmpdir(), tempFileName);
  
  let s3Key: string;
  
  try {
    // Write video file to temporary location
    const videoArrayBuffer = await videoFile.arrayBuffer();
    writeFileSync(tempFilePath, new Uint8Array(videoArrayBuffer));

    // Get aspect ratio from the temporary file
    const aspectRatio = await getVideoAspectRatio(tempFilePath);

    // Generate S3 key with aspect ratio prefix and random 32-byte hex format
    const randomKey = randomBytes(32).toString("hex");
    s3Key = `${aspectRatio}-${randomKey}.mp4`;

    // Upload to S3 from memory
    const s3File = cfg.s3Client.file(s3Key);
    await s3File.write(videoFile);
  } finally {
    // Clean up temporary file
    try {
      unlinkSync(tempFilePath);
    } catch (cleanupError) {
      console.warn("Failed to clean up temporary file:", cleanupError);
    }
  }

  // Generate S3 URL with aspect ratio path
  const aspectRatio = s3Key.startsWith('landscape-') ? 'landscape' : 
                     s3Key.startsWith('portrait-') ? 'portrait' : 'other';
  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${aspectRatio}/${s3Key}`;
  
  const updatedVideo = {
    ...video,
    videoURL: videoURL,
  };

  updateVideo(cfg.db, updatedVideo);

  return respondWithJSON(200, updatedVideo);
}
