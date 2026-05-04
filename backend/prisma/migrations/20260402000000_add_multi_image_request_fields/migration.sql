ALTER TABLE `leave_requests`
ADD COLUMN `proof_file_ids_json` JSON NULL;

ALTER TABLE `appeals`
ADD COLUMN `evidence_file_ids_json` JSON NULL;
