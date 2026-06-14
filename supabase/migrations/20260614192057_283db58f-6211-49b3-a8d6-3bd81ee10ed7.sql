SELECT cron.schedule(
  'sdr-reply-tick',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--fd74efe5-cf58-41a7-bfa9-143b6e768fe0.lovable.app/api/public/hooks/sdr-reply-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqdmprYmFyb2xjb3d4YmxwY2hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzY3OTcsImV4cCI6MjA5NDYxMjc5N30.7PzutU175M-p2ypuqAbFYfhcRmZgMVrPqULgWQG0knA'
    ),
    body := '{}'::jsonb
  );
  SELECT pg_sleep(15);
  SELECT net.http_post(
    url := 'https://project--fd74efe5-cf58-41a7-bfa9-143b6e768fe0.lovable.app/api/public/hooks/sdr-reply-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqdmprYmFyb2xjb3d4YmxwY2hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzY3OTcsImV4cCI6MjA5NDYxMjc5N30.7PzutU175M-p2ypuqAbFYfhcRmZgMVrPqULgWQG0knA'
    ),
    body := '{}'::jsonb
  );
  SELECT pg_sleep(15);
  SELECT net.http_post(
    url := 'https://project--fd74efe5-cf58-41a7-bfa9-143b6e768fe0.lovable.app/api/public/hooks/sdr-reply-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqdmprYmFyb2xjb3d4YmxwY2hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzY3OTcsImV4cCI6MjA5NDYxMjc5N30.7PzutU175M-p2ypuqAbFYfhcRmZgMVrPqULgWQG0knA'
    ),
    body := '{}'::jsonb
  );
  SELECT pg_sleep(15);
  SELECT net.http_post(
    url := 'https://project--fd74efe5-cf58-41a7-bfa9-143b6e768fe0.lovable.app/api/public/hooks/sdr-reply-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqdmprYmFyb2xjb3d4YmxwY2hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzY3OTcsImV4cCI6MjA5NDYxMjc5N30.7PzutU175M-p2ypuqAbFYfhcRmZgMVrPqULgWQG0knA'
    ),
    body := '{}'::jsonb
  );
  $cron$
);