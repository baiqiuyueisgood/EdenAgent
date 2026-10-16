/** QQ ordinary files use decimal MB; encoded requests include a bounded metadata allowance. */
export const QQ_FILE_MAX_BYTES = 100_000_000
export const QQ_FILE_MAX_BASE64_LENGTH = 4 * Math.ceil(QQ_FILE_MAX_BYTES / 3)
export const QQ_FILE_MAX_JSON_BYTES = QQ_FILE_MAX_BASE64_LENGTH + 64 * 1024
export const QQ_FILE_MAX_ATTACHMENTS = 4
export const QQ_FILE_MAX_INPUT_BYTES = QQ_FILE_MAX_BYTES * QQ_FILE_MAX_ATTACHMENTS
export const QQ_FILE_TRANSFER_TIMEOUT_MS = 300_000
