CREATE TABLE IF NOT EXISTS scheduler_users (
 id CHAR(48) PRIMARY KEY, name VARCHAR(60) NOT NULL, email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, verified TINYINT NOT NULL DEFAULT 0,
 session_version INT NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS scheduler_tokens (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(48) NOT NULL, purpose VARCHAR(12) NOT NULL,
 expires_at BIGINT NOT NULL, FOREIGN KEY(user_id) REFERENCES scheduler_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS scheduler_meetings (
 id VARCHAR(48) PRIMARY KEY, owner_id CHAR(48), title VARCHAR(100) NOT NULL,
 description TEXT NOT NULL, zone VARCHAR(80) NOT NULL, dates TEXT NOT NULL,
 start INT NOT NULL, end INT NOT NULL, duration INT NOT NULL,
 organizer_secret CHAR(64), organizer_email VARCHAR(254), scheduled_date CHAR(10), scheduled_start INT,
 revision INT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(owner_id) REFERENCES scheduler_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS scheduler_responses (
 id VARCHAR(48) PRIMARY KEY, meeting VARCHAR(48) NOT NULL, user_id CHAR(48),
 name VARCHAR(60) NOT NULL, email VARCHAR(254), secret CHAR(64) NOT NULL, slots TEXT NOT NULL,
 UNIQUE KEY response_secret(meeting,secret), UNIQUE KEY response_user(meeting,user_id),
 FOREIGN KEY(meeting) REFERENCES scheduler_meetings(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES scheduler_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS scheduler_outbox (
 id CHAR(48) PRIMARY KEY, meeting VARCHAR(48), recipient VARCHAR(254) NOT NULL,
 subject VARCHAR(180) NOT NULL, body MEDIUMTEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
 attempts INT NOT NULL DEFAULT 0, next_attempt BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_error VARCHAR(255),
 INDEX delivery_queue(status,next_attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS scheduler_limits (
 bucket CHAR(64) PRIMARY KEY, hits INT NOT NULL, expires_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
