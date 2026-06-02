-- Database Schema for AI Smart Financial Intelligence & Trading Decision System
-- Target: Supabase (PostgreSQL)

DROP TABLE IF EXISTS market_news;
DROP TABLE IF EXISTS system_config;

-- 1. Create system_config Table
CREATE TABLE system_config (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, now()) NOT NULL
);

-- 2. Create market_news Table
CREATE TABLE market_news (
    id VARCHAR(255) PRIMARY KEY,
    source VARCHAR(255),
    original_title TEXT,
    ai_summary TEXT,
    sentiment VARCHAR(50),
    total_score INT,
    raw_indicators JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, now()) NOT NULL
);

-- 3. Create Descending Indexes for Performance Optimization
CREATE INDEX idx_market_news_total_score_desc ON market_news (total_score DESC);
CREATE INDEX idx_market_news_created_at_desc ON market_news (created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_news ENABLE ROW LEVEL SECURITY;

-- 5. Establish RLS Security Policies
-- Anyone (including anonymous public users) is allowed SELECT read operations.
-- INSERT, UPDATE, and DELETE are restricted to service_role (which bypasses RLS automatically).

CREATE POLICY "Allow public read system_config" 
ON system_config 
FOR SELECT 
TO public 
USING (true);

CREATE POLICY "Allow public read market_news" 
ON market_news 
FOR SELECT 
TO public 
USING (true);

-- 6. Insert Default Whitelist Data
INSERT INTO system_config (key, value) 
VALUES ('white_list', '台積電,2330,聯發科,2454,NVDA,輝達,TSLA,特斯拉,聯準會,Fed,CPI,非農')
ON CONFLICT (key) 
DO UPDATE SET value = EXCLUDED.value, updated_at = TIMEZONE('utc'::text, now());
