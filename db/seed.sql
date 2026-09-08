-- =============================================================================
-- Forge Platform — Seed Data
-- Reference data for badges, and sample exercises
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Badges (EP-19 gamification)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO badges (slug, name, description, category, criteria, sort_order) VALUES
  ('first_workout', 'First Workout', 'Complete your first workout session', 'milestone',
   '{"type": "session_count", "threshold": 1}', 1),
  ('first_pr', 'PR Breaker', 'Hit your first personal record', 'strength',
   '{"type": "pr_count", "threshold": 1}', 2),
  ('streak_7', 'Week Warrior', 'Maintain a 7-day logging streak', 'consistency',
   '{"type": "streak", "streak_type": "logging", "threshold": 7}', 3),
  ('streak_30', 'Monthly Machine', 'Maintain a 30-day logging streak', 'consistency',
   '{"type": "streak", "streak_type": "logging", "threshold": 30}', 4),
  ('streak_90', 'Quarter Beast', 'Maintain a 90-day logging streak', 'consistency',
   '{"type": "streak", "streak_type": "logging", "threshold": 90}', 5),
  ('sessions_10', 'Getting Started', 'Complete 10 workout sessions', 'logging',
   '{"type": "session_count", "threshold": 10}', 6),
  ('sessions_30', 'Committed', 'Complete 30 workout sessions', 'logging',
   '{"type": "session_count", "threshold": 30}', 7),
  ('sessions_100', 'Century Club', 'Complete 100 workout sessions', 'logging',
   '{"type": "session_count", "threshold": 100}', 8),
  ('sessions_365', 'Year of Iron', 'Complete 365 workout sessions', 'logging',
   '{"type": "session_count", "threshold": 365}', 9),
  ('macro_streak_7', 'Macro Master', 'Hit your macro targets 7 days in a row', 'nutrition',
   '{"type": "streak", "streak_type": "macros", "threshold": 7}', 10),
  ('macro_streak_30', 'Nutrition Pro', 'Hit your macro targets 30 days in a row', 'nutrition',
   '{"type": "streak", "streak_type": "macros", "threshold": 30}', 11),
  ('bodyweight_pr', 'Bodyweight Benchmark', 'Bench press your bodyweight', 'strength',
   '{"type": "bodyweight_ratio", "exercise_slug": "barbell_bench_press", "ratio": 1.0}', 12),
  ('double_bodyweight_squat', 'Squat King', 'Squat double your bodyweight', 'strength',
   '{"type": "bodyweight_ratio", "exercise_slug": "barbell_back_squat", "ratio": 2.0}', 13),
  ('12_weeks', '12 Week Transform', 'Complete a full 12-week program', 'milestone',
   '{"type": "program_completed", "min_weeks": 12}', 14),
  ('first_challenge', 'Challenger', 'Complete your first challenge', 'milestone',
   '{"type": "challenge_completed", "threshold": 1}', 15);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sample exercises (core library stubs — extend with full library import)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO exercises (name, name_ar, slug, muscle_group, equipment, movement_pattern, difficulty, is_custom) VALUES
  -- Chest
  ('Barbell Bench Press', NULL, 'barbell_bench_press', 'chest', 'barbell', 'push', 'intermediate', FALSE),
  ('Dumbbell Bench Press', NULL, 'dumbbell_bench_press', 'chest', 'dumbbell', 'push', 'beginner', FALSE),
  ('Incline Barbell Press', NULL, 'incline_barbell_press', 'chest', 'barbell', 'push', 'intermediate', FALSE),
  ('Cable Fly', NULL, 'cable_fly', 'chest', 'cable', 'push', 'beginner', FALSE),
  ('Push Up', NULL, 'push_up', 'chest', 'bodyweight', 'push', 'beginner', FALSE),
  ('Dips (Chest)', NULL, 'dips_chest', 'chest', 'bodyweight', 'push', 'intermediate', FALSE),

  -- Back
  ('Barbell Deadlift', NULL, 'barbell_deadlift', 'back', 'barbell', 'hinge', 'advanced', FALSE),
  ('Barbell Row', NULL, 'barbell_row', 'back', 'barbell', 'pull', 'intermediate', FALSE),
  ('Pull Up', NULL, 'pull_up', 'back', 'pull_up_bar', 'pull', 'intermediate', FALSE),
  ('Lat Pulldown', NULL, 'lat_pulldown', 'lats', 'cable', 'pull', 'beginner', FALSE),
  ('Seated Cable Row', NULL, 'seated_cable_row', 'back', 'cable', 'pull', 'beginner', FALSE),
  ('Dumbbell Row', NULL, 'dumbbell_row', 'back', 'dumbbell', 'pull', 'beginner', FALSE),

  -- Legs
  ('Barbell Back Squat', NULL, 'barbell_back_squat', 'quadriceps', 'barbell', 'squat', 'intermediate', FALSE),
  ('Barbell Front Squat', NULL, 'barbell_front_squat', 'quadriceps', 'barbell', 'squat', 'advanced', FALSE),
  ('Leg Press', NULL, 'leg_press', 'quadriceps', 'machine', 'squat', 'beginner', FALSE),
  ('Romanian Deadlift', NULL, 'romanian_deadlift', 'hamstrings', 'barbell', 'hinge', 'intermediate', FALSE),
  ('Leg Curl', NULL, 'leg_curl', 'hamstrings', 'machine', 'pull', 'beginner', FALSE),
  ('Leg Extension', NULL, 'leg_extension', 'quadriceps', 'machine', 'push', 'beginner', FALSE),
  ('Bulgarian Split Squat', NULL, 'bulgarian_split_squat', 'quadriceps', 'dumbbell', 'lunge', 'intermediate', FALSE),
  ('Walking Lunge', NULL, 'walking_lunge', 'quadriceps', 'dumbbell', 'lunge', 'beginner', FALSE),
  ('Hip Thrust', NULL, 'hip_thrust', 'glutes', 'barbell', 'hinge', 'intermediate', FALSE),
  ('Calf Raise', NULL, 'calf_raise', 'calves', 'machine', 'push', 'beginner', FALSE),

  -- Shoulders
  ('Overhead Press', NULL, 'overhead_press', 'shoulders', 'barbell', 'push', 'intermediate', FALSE),
  ('Dumbbell Lateral Raise', NULL, 'dumbbell_lateral_raise', 'shoulders', 'dumbbell', 'push', 'beginner', FALSE),
  ('Face Pull', NULL, 'face_pull', 'shoulders', 'cable', 'pull', 'beginner', FALSE),
  ('Arnold Press', NULL, 'arnold_press', 'shoulders', 'dumbbell', 'push', 'intermediate', FALSE),

  -- Arms
  ('Barbell Curl', NULL, 'barbell_curl', 'biceps', 'barbell', 'pull', 'beginner', FALSE),
  ('Dumbbell Curl', NULL, 'dumbbell_curl', 'biceps', 'dumbbell', 'pull', 'beginner', FALSE),
  ('Hammer Curl', NULL, 'hammer_curl', 'biceps', 'dumbbell', 'pull', 'beginner', FALSE),
  ('Tricep Pushdown', NULL, 'tricep_pushdown', 'triceps', 'cable', 'push', 'beginner', FALSE),
  ('Skull Crushers', NULL, 'skull_crushers', 'triceps', 'barbell', 'push', 'intermediate', FALSE),
  ('Close Grip Bench Press', NULL, 'close_grip_bench', 'triceps', 'barbell', 'push', 'intermediate', FALSE),

  -- Core
  ('Plank', NULL, 'plank', 'abs', 'bodyweight', 'isometric', 'beginner', FALSE),
  ('Hanging Leg Raise', NULL, 'hanging_leg_raise', 'abs', 'pull_up_bar', 'pull', 'intermediate', FALSE),
  ('Cable Woodchop', NULL, 'cable_woodchop', 'obliques', 'cable', 'rotation', 'intermediate', FALSE),
  ('Ab Wheel Rollout', NULL, 'ab_wheel_rollout', 'abs', 'other', 'push', 'advanced', FALSE),

  -- Full body / Cardio
  ('Kettlebell Swing', NULL, 'kettlebell_swing', 'full_body', 'kettlebell', 'hinge', 'intermediate', FALSE),
  ('Burpee', NULL, 'burpee', 'full_body', 'bodyweight', 'plyometric', 'intermediate', FALSE),
  ('Farmer Walk', NULL, 'farmer_walk', 'full_body', 'dumbbell', 'carry', 'beginner', FALSE),
  ('Treadmill Run', NULL, 'treadmill_run', 'cardio', 'cardio_machine', 'cardio', 'beginner', FALSE),
  ('Rowing Machine', NULL, 'rowing_machine', 'full_body', 'cardio_machine', 'cardio', 'beginner', FALSE);

COMMIT;
