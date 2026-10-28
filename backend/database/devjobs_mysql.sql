CREATE DATABASE IF NOT EXISTS devjobs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE devjobs;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  account_type ENUM('candidate', 'employer', 'admin') NOT NULL DEFAULT 'candidate',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_account_type (account_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS candidate_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  location VARCHAR(160) NULL,
  about TEXT NULL,
  job_title VARCHAR(120) NULL,
  company VARCHAR(160) NULL,
  experience_years TINYINT UNSIGNED NULL,
  skills JSON NOT NULL,
  resume_name VARCHAR(180) NULL,
  resume_type VARCHAR(100) NULL,
  resume_data MEDIUMBLOB NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_candidate_profiles_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  industry VARCHAR(100) NOT NULL,
  company_size ENUM('1-10', '11-50', '51-200', '201-500', '501+') NULL,
  location VARCHAR(160) NULL,
  description TEXT NULL,
  website_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_companies_name (name),
  KEY idx_companies_industry (industry),
  CONSTRAINT fk_companies_owner
    FOREIGN KEY (owner_user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_categories (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_categories_slug (slug),
  UNIQUE KEY uq_job_categories_name (name)
) ENGINE=InnoDB;

INSERT IGNORE INTO job_categories (slug, name) VALUES
  ('frontend', 'Frontend'),
  ('backend', 'Backend'),
  ('data', 'Datos'),
  ('design', 'Diseño de producto'),
  ('devops', 'DevOps');

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  category_id SMALLINT UNSIGNED NOT NULL,
  title VARCHAR(140) NOT NULL,
  location VARCHAR(160) NOT NULL,
  work_mode ENUM('remote', 'hybrid', 'onsite') NOT NULL,
  employment_type ENUM('full_time', 'part_time', 'contract') NOT NULL,
  salary_min DECIMAL(12, 2) NULL,
  salary_max DECIMAL(12, 2) NULL,
  salary_currency CHAR(3) NOT NULL DEFAULT 'MXN',
  description TEXT NOT NULL,
  contact_email VARCHAR(254) NOT NULL,
  status ENUM('draft', 'published', 'paused', 'closed') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_jobs_status_published (status, published_at),
  KEY idx_jobs_category_status (category_id, status),
  KEY idx_jobs_company_status (company_id, status),
  KEY idx_jobs_work_mode (work_mode),
  CONSTRAINT chk_jobs_salary_range CHECK (
    (salary_min IS NULL AND salary_max IS NULL)
    OR (salary_min IS NOT NULL AND salary_max IS NOT NULL AND salary_min >= 0 AND salary_max >= salary_min)
  ),
  CONSTRAINT fk_jobs_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_jobs_creator
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_jobs_category
    FOREIGN KEY (category_id) REFERENCES job_categories (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_bullets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  bullet_type ENUM('responsibility', 'requirement', 'benefit') NOT NULL,
  content VARCHAR(500) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_job_bullets_job_type (job_id, bullet_type, sort_order),
  CONSTRAINT fk_job_bullets_job
    FOREIGN KEY (job_id) REFERENCES jobs (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS skills (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skills_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_skills (
  job_id BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (job_id, skill_id),
  CONSTRAINT fk_job_skills_job
    FOREIGN KEY (job_id) REFERENCES jobs (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_job_skills_skill
    FOREIGN KEY (skill_id) REFERENCES skills (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  candidate_user_id BIGINT UNSIGNED NULL,
  applicant_name VARCHAR(120) NOT NULL,
  applicant_email VARCHAR(254) NOT NULL,
  portfolio_url VARCHAR(500) NULL,
  cover_letter TEXT NULL,
  status ENUM('submitted', 'reviewing', 'interview', 'rejected', 'accepted', 'withdrawn') NOT NULL DEFAULT 'submitted',
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_applications_job_email (job_id, applicant_email),
  KEY idx_applications_candidate (candidate_user_id, applied_at),
  KEY idx_applications_job_status (job_id, status),
  CONSTRAINT fk_applications_job
    FOREIGN KEY (job_id) REFERENCES jobs (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_applications_candidate
    FOREIGN KEY (candidate_user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS saved_jobs (
  candidate_user_id BIGINT UNSIGNED NOT NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (candidate_user_id, job_id),
  CONSTRAINT fk_saved_jobs_candidate
    FOREIGN KEY (candidate_user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_saved_jobs_job
    FOREIGN KEY (job_id) REFERENCES jobs (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS salary_benchmarks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id SMALLINT UNSIGNED NOT NULL,
  experience_level ENUM('junior', 'mid', 'senior') NOT NULL,
  location VARCHAR(120) NOT NULL,
  monthly_min DECIMAL(12, 2) NOT NULL,
  monthly_median DECIMAL(12, 2) NOT NULL,
  monthly_max DECIMAL(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  sample_size INT UNSIGNED NULL,
  source_name VARCHAR(160) NULL,
  source_url VARCHAR(500) NULL,
  observed_at DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salary_benchmarks_lookup (category_id, experience_level, location, observed_at),
  CONSTRAINT chk_salary_benchmarks_range CHECK (
    monthly_min >= 0 AND monthly_median >= monthly_min AND monthly_max >= monthly_median
  ),
  CONSTRAINT fk_salary_benchmarks_category
    FOREIGN KEY (category_id) REFERENCES job_categories (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;