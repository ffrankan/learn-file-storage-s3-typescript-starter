import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";


const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png"];
export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const data = await req.formData();
  const thumbnail = data.get("thumbnail");
  if (!(thumbnail instanceof File)) {
    throw new BadRequestError("Invalid thumbnail");
  }
  
  const MAX_UPLOAD_SIZE = 10 << 20; // 10MB
  if (thumbnail.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size exceeds 10MB limit");
  }
  
  const mediaType = thumbnail.type;
  if(!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    throw new BadRequestError("Invalid media type");
  }
  
  const thumbnailBuffer = await thumbnail.arrayBuffer();
  
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }
  
  if (video.userID !== userID) {
    throw new UserForbiddenError("You are not authorized to upload thumbnails for this video");
  }
  
  // Get file extension from media type
  const fileExtension = mediaType.split('/')[1];
  const fileName = `${videoId}.${fileExtension}`;
  const filePath = path.join(cfg.assetsRoot, fileName);
  
  // Save file to assets directory
  await Bun.write(filePath, new Uint8Array(thumbnailBuffer));
  
  // Construct full URL with protocol and host
  const host = req.headers.get('host') || `localhost:${cfg.port}`;
  const protocol = req.headers.get('x-forwarded-proto') || 'http';
  const thumbnailUrl = `${protocol}://${host}/assets/${fileName}`;
  
  const updatedVideo = {
    ...video,
    thumbnailURL: thumbnailUrl,
  };
  
  updateVideo(cfg.db, updatedVideo);
  
  return respondWithJSON(200, updatedVideo);
}
