import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/**
 * Where one copy of the footage is. The backup can also be declared not
 * needed; either copy can be flagged as having a problem.
 */
export const custodyStatus = z.enum(['pending', 'copied', 'verified', 'issue', 'not_required'])
export type CustodyStatus = z.infer<typeof custodyStatus>
export const primaryStatus = z.enum(['pending', 'copied', 'verified', 'issue'])
export const backupStatus = custodyStatus

/**
 * The stage a record is at, derived by the database from the two copies
 * (0160) -- never set by a caller.
 */
export const dataStage = z.enum(['with_shooter', 'received', 'copied', 'backed_up', 'verified', 'issue', 'not_required'])
export type DataStage = z.infer<typeof dataStage>

export const storageLocationKind = z.enum(['drive', 'nas', 'cloud', 'other'])
export type StorageLocationKind = z.infer<typeof storageLocationKind>

export const storageLocation = z.object({
  id: uuid,
  name: z.string(),
  kind: storageLocationKind,
  // Lovable parity (additive, defaulted so old rows parse).
  location_type: z.string().nullable().default(null),
  capacity_gb: z.number().nullable().default(null),
  owner: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
})
export type StorageLocation = z.infer<typeof storageLocation>

export const createStorageLocationRequest = z.object({
  name: z.string().trim().min(1).max(120),
  kind: storageLocationKind.default('drive'),
  location_type: z.string().trim().max(80).optional(),
  capacity_gb: z.number().min(0).optional(),
  owner: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
  is_active: z.boolean().optional(),
})
export type CreateStorageLocationRequest = z.infer<typeof createStorageLocationRequest>

export const updateStorageLocationRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: storageLocationKind.optional(),
  location_type: z.string().trim().max(80).nullable().optional(),
  capacity_gb: z.number().min(0).nullable().optional(),
  owner: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
})
export type UpdateStorageLocationRequest = z.infer<typeof updateStorageLocationRequest>

export const dataRecord = z.object({
  id: uuid,
  data_label: z.string(),
  data_type: z.string().nullable(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  shoot_id: uuid.nullable(),
  primary_status: primaryStatus.catch('pending'),
  backup_status: backupStatus.catch('pending'),
  primary_location_id: uuid.nullable(),
  primary_location_name: z.string().nullable(),
  backup_location_id: uuid.nullable(),
  backup_location_name: z.string().nullable(),
  card_count: z.number().int(),
  size_gb: z.number(),
  verified_at: isoDateTime.nullable(),
  created_at: isoDateTime,
  // Lovable parity (additive, defaulted).
  folder_path: z.string().nullable().default(null),
  cloud_link: z.string().nullable().default(null),
  file_count: z.number().int().default(0),
  date_received: z.string().nullable().default(null),
  received_by_name: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  data_status: dataStage.catch('with_shooter'),
  issue_found: z.boolean().default(false),
  is_not_required: z.boolean().default(false),
  team_member_name: z.string().nullable().default(null),
  requirement_name: z.string().nullable().default(null),
  /** The booking this data came off, and whose cards they were. */
  slot_id: uuid.nullable().default(null),
  user_id: uuid.nullable().default(null),
  user_name: z.string().nullable().default(null),
  /** Who copied it: a team member, or a typed name for an outside helper. */
  copied_by_uid: uuid.nullable().default(null),
  copied_by_name: z.string().nullable().default(null),
  shoot_name: z.string().nullable().default(null),
  shoot_date: z.string().nullable().default(null),
  backup_folder_path: z.string().nullable().default(null),
  backup_cloud_link: z.string().nullable().default(null),
})
export type DataRecord = z.infer<typeof dataRecord>

export const createDataRecordRequest = z.object({
  shoot_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  data_label: z.string().trim().min(1).max(160),
  data_type: z.string().max(80).optional(),
  card_count: z.number().int().min(0).default(0),
  size_gb: z.number().min(0).default(0),
  primary_location_id: uuid.nullable().optional(),
  backup_location_id: uuid.nullable().optional(),
  folder_path: z.string().trim().max(500).optional(),
  cloud_link: z.string().trim().max(500).optional(),
  file_count: z.number().int().min(0).optional(),
  date_received: z.string().optional(),
  received_by_name: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
  data_status: z.string().max(40).optional(),
  issue_found: z.boolean().optional(),
  is_not_required: z.boolean().optional(),
  team_member_name: z.string().trim().max(160).optional(),
  requirement_name: z.string().trim().max(160).optional(),
  backup_granularity: z.string().trim().max(80).optional(),
  /** Tie the record to a booking; the API fills the person and role from it. */
  slot_id: uuid.nullable().optional(),
  user_id: uuid.nullable().optional(),
  /** A team member; or leave null and give copied_by_name for anyone else. */
  copied_by_uid: uuid.nullable().optional(),
  copied_by_name: z.string().trim().max(160).nullable().optional(),
  primary_status: primaryStatus.optional(),
  backup_status: backupStatus.optional(),
  backup_folder_path: z.string().trim().max(500).optional(),
  backup_cloud_link: z.string().trim().max(500).optional(),
})
export type CreateDataRecordRequest = z.infer<typeof createDataRecordRequest>

export const updateDataRecordRequest = z.object({
  shoot_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
  data_label: z.string().trim().min(1).max(160).optional(),
  data_type: z.string().max(80).nullable().optional(),
  card_count: z.number().int().min(0).optional(),
  size_gb: z.number().min(0).optional(),
  primary_location_id: uuid.nullable().optional(),
  backup_location_id: uuid.nullable().optional(),
  folder_path: z.string().trim().max(500).nullable().optional(),
  cloud_link: z.string().trim().max(500).nullable().optional(),
  file_count: z.number().int().min(0).optional(),
  date_received: z.string().nullable().optional(),
  received_by_name: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  data_status: z.string().max(40).optional(),
  issue_found: z.boolean().optional(),
  is_not_required: z.boolean().optional(),
  team_member_name: z.string().trim().max(160).nullable().optional(),
  requirement_name: z.string().trim().max(160).nullable().optional(),
  backup_granularity: z.string().trim().max(80).nullable().optional(),
  slot_id: uuid.nullable().optional(),
  user_id: uuid.nullable().optional(),
  copied_by_uid: uuid.nullable().optional(),
  copied_by_name: z.string().trim().max(160).nullable().optional(),
  primary_status: primaryStatus.optional(),
  backup_status: backupStatus.optional(),
  backup_folder_path: z.string().trim().max(500).nullable().optional(),
  backup_cloud_link: z.string().trim().max(500).nullable().optional(),
})
export type UpdateDataRecordRequest = z.infer<typeof updateDataRecordRequest>

export const verifyDataRequest = z.object({ track: z.enum(['primary', 'backup']) })

/** Move one copy along: POST /data/:id/track. */
export const setDataTrackRequest = z.object({
  track: z.enum(['primary', 'backup']),
  status: custodyStatus,
})
export type SetDataTrackRequest = z.infer<typeof setDataTrackRequest>
