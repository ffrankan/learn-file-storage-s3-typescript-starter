import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type Video = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  description: string;
  thumbnailURL?: string;
  videoURL?: string;
  s3Key?: string;
  userID: string;
};

export type CreateVideoParams = {
  title: string;
  description: string;
  userID: string;
};

type VideoRow = {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  description: string;
  thumbnail_url?: string;
  video_url?: string;
  s3_key?: string;
  user_id: string;
};

export function getVideos(db: Database, userID: string): Video[] {
  const sql = `
    SELECT
      id,
      created_at,
      updated_at,
      title,
      description,
      thumbnail_url,
      video_url,
      s3_key,
      user_id
    FROM videos
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  const rows = db.query<VideoRow, [string]>(sql).all(userID);

  const videos: Video[] = rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    title: row.title,
    description: row.description,
    thumbnailURL: row.thumbnail_url,
    videoURL: row.video_url,
    s3Key: row.s3_key,
    userID: row.user_id,
  }));

  return videos;
}

export function createVideo(
  db: Database,
  params: CreateVideoParams,
): Video | undefined {
  const id = randomUUID();

  const sql = `
    INSERT INTO videos (
      id,
      created_at,
      updated_at,
      title,
      description,
      user_id
    ) VALUES (
      ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?
    )
  `;

  db.run(sql, [id, params.title, params.description, params.userID]);

  return getVideo(db, id);
}

export function getVideo(db: Database, id: string): Video | undefined {
  const sql = `
    SELECT
      id,
      created_at,
      updated_at,
      title,
      description,
      thumbnail_url,
      video_url,
      s3_key,
      user_id
    FROM videos
    WHERE id = ?
  `;

  const row = db.query<VideoRow, [string]>(sql).get(id);

  if (!row) {
    return;
  }

  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    title: row.title,
    description: row.description,
    thumbnailURL: row.thumbnail_url ?? undefined,
    videoURL: row.video_url ?? undefined,
    s3Key: row.s3_key ?? undefined,
    userID: row.user_id,
  };
}

export function updateVideo(db: Database, video: Video): void {
  const sql = `
    UPDATE videos
    SET
      title = ?,
      description = ?,
      thumbnail_url = ?,
      video_url = ?,
      user_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  db.run(sql, [
    video.title,
    video.description,
    video.thumbnailURL ?? null,
    video.videoURL ?? null,
    video.userID,
    video.id,
  ]);
}

export function deleteVideo(db: Database, id: string): void {
  const sql = `
    DELETE FROM videos
    WHERE id = ?
  `;
  db.run(sql, [id]);
}
