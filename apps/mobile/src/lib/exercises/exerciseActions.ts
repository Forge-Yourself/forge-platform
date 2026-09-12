import type { CreateCustomExerciseInput } from '@forge/shared';
import { supabase } from '../supabase';

/**
 * Thin wrapper around create_custom_exercise()
 * (supabase/migrations/0007_m3_programming.sql). No business logic here — the
 * database owns it: the RPC forces is_custom and created_by_user_id itself
 * and generates a collision-safe slug, none of which a caller can influence.
 */
export async function createCustomExercise(input: CreateCustomExerciseInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_custom_exercise', {
    p_name: input.name,
    p_muscle_group: input.muscleGroup,
    p_equipment: input.equipment,
    p_movement_pattern: input.movementPattern,
    p_difficulty: input.difficulty,
    p_instructions: input.instructions,
    p_coaching_cues: input.coachingCues,
    p_demo_video_url: input.demoVideoUrl,
  });
  if (error) throw error;
  return data;
}
