export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_credit_packs: {
        Row: {
          charge_id: string | null
          created_at: string
          credits: number
          currency: string
          id: string
          price_cents: number
          purchase_channel: string
          purchased_at: string
          tier: string
          wallet_id: string
        }
        Insert: {
          charge_id?: string | null
          created_at?: string
          credits: number
          currency?: string
          id?: string
          price_cents: number
          purchase_channel: string
          purchased_at?: string
          tier: string
          wallet_id: string
        }
        Update: {
          charge_id?: string | null
          created_at?: string
          credits?: number
          currency?: string
          id?: string
          price_cents?: number
          purchase_channel?: string
          purchased_at?: string
          tier?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_acp_charge"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_acp_wallet"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          low_balance_warned_at: string | null
          total_consumed: number
          total_purchased: number
          total_refunded: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          low_balance_warned_at?: string | null
          total_consumed?: number
          total_purchased?: number
          total_refunded?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          low_balance_warned_at?: string | null
          total_consumed?: number
          total_purchased?: number
          total_refunded?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_acw_user"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generations: {
        Row: {
          created_at: string
          credits_charged: number
          generation_type: string
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model_id: string
          output_scrubbed: string | null
          output_tokens: number | null
          prompt_hash: string
          prompt_scrubbed: string | null
          refund_reason: string | null
          result_entity_id: string | null
          result_entity_type: string | null
          user_id: string
          was_refunded: boolean
        }
        Insert: {
          created_at?: string
          credits_charged?: number
          generation_type: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model_id: string
          output_scrubbed?: string | null
          output_tokens?: number | null
          prompt_hash: string
          prompt_scrubbed?: string | null
          refund_reason?: string | null
          result_entity_id?: string | null
          result_entity_type?: string | null
          user_id: string
          was_refunded?: boolean
        }
        Update: {
          created_at?: string
          credits_charged?: number
          generation_type?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model_id?: string
          output_scrubbed?: string | null
          output_tokens?: number | null
          prompt_hash?: string
          prompt_scrubbed?: string | null
          refund_reason?: string | null
          result_entity_id?: string | null
          result_entity_type?: string | null
          user_id?: string
          was_refunded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_aigen_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_05: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_06: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_07: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_08: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_09: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_10: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_11: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2026_12: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2027_01: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2027_02: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2027_03: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2027_04: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2027_05: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_logs_2027_06: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          reason_code: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          reason_code?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      badges: {
        Row: {
          category: string
          created_at: string
          criteria: Json
          description: string
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          criteria: Json
          description: string
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          criteria?: Json
          description?: string
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      body_metrics: {
        Row: {
          body_fat_pct: number | null
          circumferences: Json | null
          client_id: string
          created_at: string
          id: string
          measured_at: string
          source: string
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          body_fat_pct?: number | null
          circumferences?: Json | null
          client_id: string
          created_at?: string
          id?: string
          measured_at?: string
          source?: string
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          body_fat_pct?: number | null
          circumferences?: Json | null
          client_id?: string
          created_at?: string
          id?: string
          measured_at?: string
          source?: string
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_bm_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          class_id: string | null
          client_id: string | null
          created_at: string
          ends_at: string
          google_calendar_id: string | null
          gym_id: string | null
          ical_uid: string | null
          id: string
          location_name: string | null
          no_show_marked_at: string | null
          notes: string | null
          originating_timezone: string
          parent_booking_id: string | null
          pt_user_id: string
          recurrence_rule: string | null
          reminder_1h_sent: boolean
          reminder_24h_sent: boolean
          schedule_id: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_id?: string | null
          client_id?: string | null
          created_at?: string
          ends_at: string
          google_calendar_id?: string | null
          gym_id?: string | null
          ical_uid?: string | null
          id?: string
          location_name?: string | null
          no_show_marked_at?: string | null
          notes?: string | null
          originating_timezone?: string
          parent_booking_id?: string | null
          pt_user_id: string
          recurrence_rule?: string | null
          reminder_1h_sent?: boolean
          reminder_24h_sent?: boolean
          schedule_id?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_id?: string | null
          client_id?: string | null
          created_at?: string
          ends_at?: string
          google_calendar_id?: string | null
          gym_id?: string | null
          ical_uid?: string | null
          id?: string
          location_name?: string | null
          no_show_marked_at?: string | null
          notes?: string | null
          originating_timezone?: string
          parent_booking_id?: string | null
          pt_user_id?: string
          recurrence_rule?: string | null
          reminder_1h_sent?: boolean
          reminder_24h_sent?: boolean
          schedule_id?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_bookings_class"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bookings_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bookings_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bookings_parent"
            columns: ["parent_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bookings_pt"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bookings_schedule"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          completed_at: string | null
          created_at: string
          current_value: number
          id: string
          joined_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          joined_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          joined_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cp_challenge"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cp_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          challenge_type: string
          created_at: string
          created_by_user_id: string
          description: string | null
          duration_days: number
          ends_at: string
          id: string
          is_active: boolean
          max_participants: number | null
          name: string
          starts_at: string
          target_value: number | null
          updated_at: string
        }
        Insert: {
          challenge_type: string
          created_at?: string
          created_by_user_id: string
          description?: string | null
          duration_days?: number
          ends_at: string
          id?: string
          is_active?: boolean
          max_participants?: number | null
          name: string
          starts_at: string
          target_value?: number | null
          updated_at?: string
        }
        Update: {
          challenge_type?: string
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          duration_days?: number
          ends_at?: string
          id?: string
          is_active?: boolean
          max_participants?: number | null
          name?: string
          starts_at?: string
          target_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_challenges_creator"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      charges: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          description: string | null
          failure_reason: string | null
          id: string
          payment_method: string
          processor_fee_cents: number | null
          processor_ref: string | null
          refunded_at: string | null
          status: string
          subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          description?: string | null
          failure_reason?: string | null
          id?: string
          payment_method: string
          processor_fee_cents?: number | null
          processor_ref?: string | null
          refunded_at?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          description?: string | null
          failure_reason?: string | null
          id?: string
          payment_method?: string
          processor_fee_cents?: number | null
          processor_ref?: string | null
          refunded_at?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_charges_sub"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_charges_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          booking_id: string
          check_in_method: string
          checked_in_at: string
          checked_in_by_user_id: string
          checked_out_at: string | null
          created_at: string
          feedback_text: string | null
          id: string
          rating: number | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          check_in_method: string
          checked_in_at: string
          checked_in_by_user_id: string
          checked_out_at?: string | null
          created_at?: string
          feedback_text?: string | null
          id?: string
          rating?: number | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          check_in_method?: string
          checked_in_at?: string
          checked_in_by_user_id?: string
          checked_out_at?: string | null
          created_at?: string
          feedback_text?: string | null
          id?: string
          rating?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ci_booking"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_user"
            columns: ["checked_in_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          capacity: number
          created_at: string
          description: string | null
          duration_min: number
          gym_id: string | null
          id: string
          is_active: boolean
          name: string
          pt_user_id: string
          recurring_rule: string | null
          updated_at: string
          waitlist_capacity: number
        }
        Insert: {
          capacity: number
          created_at?: string
          description?: string | null
          duration_min?: number
          gym_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          pt_user_id: string
          recurring_rule?: string | null
          updated_at?: string
          waitlist_capacity?: number
        }
        Update: {
          capacity?: number
          created_at?: string
          description?: string | null
          duration_min?: number
          gym_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          pt_user_id?: string
          recurring_rule?: string | null
          updated_at?: string
          waitlist_capacity?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_classes_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_classes_pt"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_pt_assignments: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_active: boolean
          master_user_id: string
          pt_user_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          master_user_id: string
          pt_user_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          master_user_id?: string
          pt_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cpa_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cpa_master"
            columns: ["master_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cpa_pt"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          client_user_id: string | null
          created_at: string
          gym_id: string | null
          id: string
          invite_email: string | null
          invite_expires_at: string | null
          invite_name: string | null
          is_premium_self_serve: boolean
          notes: string | null
          pt_mode_id: string | null
          pt_user_id: string
          state: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          client_user_id?: string | null
          created_at?: string
          gym_id?: string | null
          id?: string
          invite_email?: string | null
          invite_expires_at?: string | null
          invite_name?: string | null
          is_premium_self_serve?: boolean
          notes?: string | null
          pt_mode_id?: string | null
          pt_user_id: string
          state?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          client_user_id?: string | null
          created_at?: string
          gym_id?: string | null
          id?: string
          invite_email?: string | null
          invite_expires_at?: string | null
          invite_name?: string | null
          is_premium_self_serve?: boolean
          notes?: string | null
          pt_mode_id?: string | null
          pt_user_id?: string
          state?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_clients_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_clients_pt"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_clients_pt_mode"
            columns: ["pt_mode_id"]
            isOneToOne: false
            referencedRelation: "pt_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_clients_user"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_name: string | null
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_device_tokens_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number
          cover_image_url: string | null
          created_at: string
          created_by_user_id: string
          currency: string | null
          description: string | null
          ends_at: string
          gym_id: string
          id: string
          is_cancelled: boolean
          location_name: string | null
          name: string
          starts_at: string
          ticket_price_cents: number | null
          updated_at: string
          visibility: string
        }
        Insert: {
          capacity: number
          cover_image_url?: string | null
          created_at?: string
          created_by_user_id: string
          currency?: string | null
          description?: string | null
          ends_at: string
          gym_id: string
          id?: string
          is_cancelled?: boolean
          location_name?: string | null
          name: string
          starts_at: string
          ticket_price_cents?: number | null
          updated_at?: string
          visibility: string
        }
        Update: {
          capacity?: number
          cover_image_url?: string | null
          created_at?: string
          created_by_user_id?: string
          currency?: string | null
          description?: string | null
          ends_at?: string
          gym_id?: string
          id?: string
          is_cancelled?: boolean
          location_name?: string | null
          name?: string
          starts_at?: string
          ticket_price_cents?: number | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_events_creator"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_events_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_prs: {
        Row: {
          achieved_at: string
          client_id: string
          created_at: string
          exercise_id: string
          id: string
          pr_type: string
          set_id: string | null
          value: number
        }
        Insert: {
          achieved_at?: string
          client_id: string
          created_at?: string
          exercise_id: string
          id?: string
          pr_type: string
          set_id?: string | null
          value: number
        }
        Update: {
          achieved_at?: string
          client_id?: string
          created_at?: string
          exercise_id?: string
          id?: string
          pr_type?: string
          set_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_epr_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_epr_exercise"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          coaching_cues: string[]
          created_at: string
          created_by_user_id: string | null
          difficulty: string | null
          equipment: string
          id: string
          instructions: string | null
          is_active: boolean
          is_custom: boolean
          movement_pattern: string
          muscle_group: string
          name: string
          name_ar: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          coaching_cues?: string[]
          created_at?: string
          created_by_user_id?: string | null
          difficulty?: string | null
          equipment?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          is_custom?: boolean
          movement_pattern: string
          muscle_group: string
          name: string
          name_ar?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          coaching_cues?: string[]
          created_at?: string
          created_by_user_id?: string | null
          difficulty?: string | null
          equipment?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          is_custom?: boolean
          movement_pattern?: string
          muscle_group?: string
          name?: string
          name_ar?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_exercises_creator"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      food_items: {
        Row: {
          barcode: string | null
          brand: string | null
          calories_per_serving: number
          carbs_g: number
          created_at: string
          fat_g: number
          fiber_g: number | null
          id: string
          is_verified: boolean
          name: string
          name_ar: string | null
          protein_g: number
          serving_size_g: number
          source: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          calories_per_serving: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number | null
          id?: string
          is_verified?: boolean
          name: string
          name_ar?: string | null
          protein_g?: number
          serving_size_g?: number
          source?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          calories_per_serving?: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number | null
          id?: string
          is_verified?: boolean
          name?: string
          name_ar?: string | null
          protein_g?: number
          serving_size_g?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_05: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_06: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_07: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_08: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_09: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_10: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_11: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2026_12: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2027_01: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2027_02: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2027_03: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2027_04: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2027_05: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      food_logs_2027_06: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          custom_name: string | null
          fat_g: number | null
          food_item_id: string | null
          id: string
          logged_date: string
          meal_plan_id: string | null
          meal_type: string
          protein_g: number | null
          servings: number
          source: string
          updated_at: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          custom_name?: string | null
          fat_g?: number | null
          food_item_id?: string | null
          id?: string
          logged_date?: string
          meal_plan_id?: string | null
          meal_type?: string
          protein_g?: number | null
          servings?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      form_check_comments: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          drawing_data: Json | null
          id: string
          parent_comment_id: string | null
          timestamp_ms: number
          updated_at: string
          upload_id: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          drawing_data?: Json | null
          id?: string
          parent_comment_id?: string | null
          timestamp_ms: number
          updated_at?: string
          upload_id: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          drawing_data?: Json | null
          id?: string
          parent_comment_id?: string | null
          timestamp_ms?: number
          updated_at?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_fcc_author"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fcc_parent"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "form_check_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fcc_upload"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "form_check_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      form_check_uploads: {
        Row: {
          client_id: string
          created_at: string
          duration_sec: number
          encryption_key_id: string
          exercise_id: string | null
          file_size_bytes: number
          id: string
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          thumbnail_url: string | null
          updated_at: string
          upload_status: string
          video_url: string
        }
        Insert: {
          client_id: string
          created_at?: string
          duration_sec: number
          encryption_key_id: string
          exercise_id?: string | null
          file_size_bytes: number
          id?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          upload_status?: string
          video_url: string
        }
        Update: {
          client_id?: string
          created_at?: string
          duration_sec?: number
          encryption_key_id?: string
          exercise_id?: string | null
          file_size_bytes?: number
          id?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          upload_status?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_fcu_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fcu_exercise"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fcu_reviewer"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_clients: {
        Row: {
          client_name: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          gym_id: string
          id: string
          is_active: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          client_name: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          gym_id: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          client_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          gym_id?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_gc_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_memberships: {
        Row: {
          created_at: string
          gym_id: string
          id: string
          initiated_by: string
          joined_at: string | null
          left_at: string | null
          pt_user_id: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gym_id: string
          id?: string
          initiated_by: string
          joined_at?: string | null
          left_at?: string | null
          pt_user_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gym_id?: string
          id?: string
          initiated_by?: string
          joined_at?: string | null
          left_at?: string | null
          pt_user_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_gm_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_gm_pt"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gyms: {
        Row: {
          address: string | null
          amenities: string[]
          city: string | null
          country: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          location: unknown
          logo_url: string | null
          name: string
          name_ar: string | null
          operating_hours: Json | null
          owner_user_id: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          amenities?: string[]
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location?: unknown
          logo_url?: string | null
          name: string
          name_ar?: string | null
          operating_hours?: Json | null
          owner_user_id: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          amenities?: string[]
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location?: unknown
          logo_url?: string | null
          name?: string
          name_ar?: string | null
          operating_hours?: Json | null
          owner_user_id?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_gyms_owner"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_forms: {
        Row: {
          client_id: string
          created_at: string
          id: string
          red_flags: Json | null
          responses: Json
          reviewed_at: string | null
          reviewed_by_id: string | null
          sections: Json
          signed_at: string | null
          state: string
          submitted_at: string | null
          template_version: string
          updated_at: string
          waiver_pdf_url: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          red_flags?: Json | null
          responses?: Json
          reviewed_at?: string | null
          reviewed_by_id?: string | null
          sections?: Json
          signed_at?: string | null
          state?: string
          submitted_at?: string | null
          template_version?: string
          updated_at?: string
          waiver_pdf_url?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          red_flags?: Json | null
          responses?: Json
          reviewed_at?: string | null
          reviewed_by_id?: string | null
          sections?: Json
          signed_at?: string | null
          state?: string
          submitted_at?: string | null
          template_version?: string
          updated_at?: string
          waiver_pdf_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_intake_forms_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_intake_forms_reviewer"
            columns: ["reviewed_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          blurb: string | null
          created_at: string
          expires_at: string | null
          gym_id: string | null
          id: string
          is_published: boolean
          listing_type: string
          published_at: string | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          blurb?: string | null
          created_at?: string
          expires_at?: string | null
          gym_id?: string | null
          id?: string
          is_published?: boolean
          listing_type: string
          published_at?: string | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          blurb?: string | null
          created_at?: string
          expires_at?: string | null
          gym_id?: string | null
          id?: string
          is_published?: boolean
          listing_type?: string
          published_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_listings_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_listings_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      master_sub_relations: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invite_expires_at: string | null
          invited_at: string
          left_at: string | null
          master_pt_id: string
          state: string
          sub_pt_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          invited_at?: string
          left_at?: string | null
          master_pt_id: string
          state?: string
          sub_pt_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          invited_at?: string
          left_at?: string | null
          master_pt_id?: string
          state?: string
          sub_pt_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_msr_master"
            columns: ["master_pt_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_msr_sub"
            columns: ["sub_pt_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plans: {
        Row: {
          author_user_id: string
          client_id: string
          created_at: string
          id: string
          is_ai_generated: boolean
          meals: Json
          name: string
          state: string
          target_calories: number | null
          target_carbs_g: number | null
          target_fat_g: number | null
          target_protein_g: number | null
          updated_at: string
        }
        Insert: {
          author_user_id: string
          client_id: string
          created_at?: string
          id?: string
          is_ai_generated?: boolean
          meals?: Json
          name: string
          state?: string
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          client_id?: string
          created_at?: string
          id?: string
          is_ai_generated?: boolean
          meals?: Json
          name?: string
          state?: string
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_mp_author"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_mp_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      message_recipients: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message_id: string
          read_at: string | null
          recipient_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message_id: string
          read_at?: string | null
          recipient_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message_id?: string
          read_at?: string | null
          recipient_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_mr_message"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_mr_recipient"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          edit_window_closes_at: string | null
          edited_at: string | null
          id: string
          is_deleted: boolean
          is_edited: boolean
          media_duration_sec: number | null
          media_type: string | null
          media_url: string | null
          message_type: string
          sender_user_id: string
          thread_id: string | null
          updated_at: string
          voice_transcript: string | null
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          edit_window_closes_at?: string | null
          edited_at?: string | null
          id?: string
          is_deleted?: boolean
          is_edited?: boolean
          media_duration_sec?: number | null
          media_type?: string | null
          media_url?: string | null
          message_type?: string
          sender_user_id: string
          thread_id?: string | null
          updated_at?: string
          voice_transcript?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          edit_window_closes_at?: string | null
          edited_at?: string | null
          id?: string
          is_deleted?: boolean
          is_edited?: boolean
          media_duration_sec?: number | null
          media_type?: string | null
          media_url?: string | null
          message_type?: string
          sender_user_id?: string
          thread_id?: string | null
          updated_at?: string
          voice_transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_msg_sender"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_msg_thread"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          category: string
          channel: string
          created_at: string
          enabled: boolean
          id: string
          quiet_end: string | null
          quiet_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          channel: string
          created_at?: string
          enabled?: boolean
          id?: string
          quiet_end?: string | null
          quiet_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          channel?: string
          created_at?: string
          enabled?: boolean
          id?: string
          quiet_end?: string | null
          quiet_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_np_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_05: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_06: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_07: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_08: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_09: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_10: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_11: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2026_12: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2027_01: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2027_02: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2027_03: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2027_04: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2027_05: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications_2027_06: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          deep_link: string | null
          delivered_at: string | null
          delivery_error: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_delivered: boolean
          is_read: boolean
          is_suppressed: boolean
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deep_link?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_delivered?: boolean
          is_read?: boolean
          is_suppressed?: boolean
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          charge_id: string | null
          created_at: string
          currency: string
          delivered_at: string | null
          fulfillment_provider: string | null
          id: string
          placed_at: string | null
          shipping_address: Json | null
          status: string
          total_cents: number
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          charge_id?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          fulfillment_provider?: string | null
          id?: string
          placed_at?: string | null
          shipping_address?: Json | null
          status?: string
          total_cents: number
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          charge_id?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          fulfillment_provider?: string | null
          id?: string
          placed_at?: string | null
          shipping_address?: Json | null
          status?: string
          total_cents?: number
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_charge"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_orders_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          image_urls: string[]
          is_active: boolean
          name: string
          price_cents: number
          sku: string
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_urls?: string[]
          is_active?: boolean
          name: string
          price_cents: number
          sku: string
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_urls?: string[]
          is_active?: boolean
          name?: string
          price_cents?: number
          sku?: string
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      program_blocks: {
        Row: {
          block_type: string
          created_at: string
          day_id: string
          id: string
          label: string | null
          rest_between_sec: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          block_type?: string
          created_at?: string
          day_id: string
          id?: string
          label?: string | null
          rest_between_sec?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          block_type?: string
          created_at?: string
          day_id?: string
          id?: string
          label?: string | null
          rest_between_sec?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pb_day"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "program_days"
            referencedColumns: ["id"]
          },
        ]
      }
      program_days: {
        Row: {
          created_at: string
          day_number: number
          id: string
          label: string | null
          notes: string | null
          updated_at: string
          week_id: string
        }
        Insert: {
          created_at?: string
          day_number: number
          id?: string
          label?: string | null
          notes?: string | null
          updated_at?: string
          week_id: string
        }
        Update: {
          created_at?: string
          day_number?: number
          id?: string
          label?: string | null
          notes?: string | null
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pd_week"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "program_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      program_exercises: {
        Row: {
          block_id: string
          created_at: string
          exercise_id: string
          id: string
          notes: string | null
          prescribed_distance_m: number | null
          prescribed_duration_sec: number | null
          rest_sec: number | null
          sort_order: number
          target_reps_max: number | null
          target_reps_min: number | null
          target_rpe: number | null
          target_sets: number | null
          target_weight_kg: number | null
          tempo_prescribed: string | null
          updated_at: string
        }
        Insert: {
          block_id: string
          created_at?: string
          exercise_id: string
          id?: string
          notes?: string | null
          prescribed_distance_m?: number | null
          prescribed_duration_sec?: number | null
          rest_sec?: number | null
          sort_order?: number
          target_reps_max?: number | null
          target_reps_min?: number | null
          target_rpe?: number | null
          target_sets?: number | null
          target_weight_kg?: number | null
          tempo_prescribed?: string | null
          updated_at?: string
        }
        Update: {
          block_id?: string
          created_at?: string
          exercise_id?: string
          id?: string
          notes?: string | null
          prescribed_distance_m?: number | null
          prescribed_duration_sec?: number | null
          rest_sec?: number | null
          sort_order?: number
          target_reps_max?: number | null
          target_reps_min?: number | null
          target_rpe?: number | null
          target_sets?: number | null
          target_weight_kg?: number | null
          tempo_prescribed?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pe_block"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "program_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pe_exercise"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      program_weeks: {
        Row: {
          created_at: string
          id: string
          label: string | null
          program_id: string
          updated_at: string
          week_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          program_id: string
          updated_at?: string
          week_number: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          program_id?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_pw_program"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          ai_generation_id: string | null
          author_user_id: string
          client_id: string | null
          created_at: string
          description: string | null
          duration_weeks: number
          id: string
          is_ai_generated: boolean
          is_template: boolean
          name: string
          periodization: string | null
          state: string
          template_source_id: string | null
          updated_at: string
        }
        Insert: {
          ai_generation_id?: string | null
          author_user_id: string
          client_id?: string | null
          created_at?: string
          description?: string | null
          duration_weeks: number
          id?: string
          is_ai_generated?: boolean
          is_template?: boolean
          name: string
          periodization?: string | null
          state?: string
          template_source_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_generation_id?: string | null
          author_user_id?: string
          client_id?: string | null
          created_at?: string
          description?: string | null
          duration_weeks?: number
          id?: string
          is_ai_generated?: boolean
          is_template?: boolean
          name?: string
          periodization?: string | null
          state?: string
          template_source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_programs_ai_gen"
            columns: ["ai_generation_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_programs_author"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_programs_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_programs_template"
            columns: ["template_source_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_photos: {
        Row: {
          client_id: string
          created_at: string
          encryption_key_id: string
          id: string
          is_shared_with_pt: boolean
          photo_url: string
          pose_type: string | null
          taken_at: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          encryption_key_id: string
          id?: string
          is_shared_with_pt?: boolean
          photo_url: string
          pose_type?: string | null
          taken_at?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          encryption_key_id?: string
          id?: string
          is_shared_with_pt?: boolean
          photo_url?: string
          pose_type?: string | null
          taken_at?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pp_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_certifications: {
        Row: {
          created_at: string
          document_url: string | null
          expires_on: string | null
          id: string
          issuer: string | null
          name: string
          pt_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_url?: string | null
          expires_on?: string | null
          id?: string
          issuer?: string | null
          name: string
          pt_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_url?: string | null
          expires_on?: string | null
          id?: string
          issuer?: string | null
          name?: string
          pt_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pt_certifications_user"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_modes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          master_id: string | null
          mode: string
          pt_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          master_id?: string | null
          mode: string
          pt_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          master_id?: string | null
          mode?: string
          pt_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pt_modes_master"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pt_modes_user"
            columns: ["pt_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_profiles: {
        Row: {
          bio: string | null
          certifications: string[]
          created_at: string
          currency: string | null
          hourly_rate_cents: number | null
          id: string
          is_published: boolean
          languages: string[]
          profile_photo_url: string | null
          slug: string | null
          specializations: string[]
          updated_at: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          bio?: string | null
          certifications?: string[]
          created_at?: string
          currency?: string | null
          hourly_rate_cents?: number | null
          id?: string
          is_published?: boolean
          languages?: string[]
          profile_photo_url?: string | null
          slug?: string | null
          specializations?: string[]
          updated_at?: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          bio?: string | null
          certifications?: string[]
          created_at?: string
          currency?: string | null
          hourly_rate_cents?: number | null
          id?: string
          is_published?: boolean
          languages?: string[]
          profile_photo_url?: string | null
          slug?: string | null
          specializations?: string[]
          updated_at?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pt_profiles_user"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          gym_id: string | null
          id: string
          is_active: boolean
          slot_duration_min: number
          start_time: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          gym_id?: string | null
          id?: string
          is_active?: boolean
          slot_duration_min?: number
          start_time: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          gym_id?: string | null
          id?: string
          is_active?: boolean
          slot_duration_min?: number
          start_time?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sched_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_sched_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sets: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_05: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_06: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_07: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_08: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_09: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_10: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_11: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2026_12: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2027_01: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2027_02: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2027_03: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2027_04: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2027_05: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      sets_2027_06: {
        Row: {
          conflict_resolved: boolean
          created_at: string
          device_id: string | null
          distance_m: number | null
          duration_sec: number | null
          exercise_id: string
          id: string
          is_drop_set: boolean
          is_failure: boolean
          is_synced: boolean
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          set_number: number
          synced_at: string | null
          tempo_actual: string | null
          updated_at: string
          weight_kg: number | null
          workout_session_id: string
        }
        Insert: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id: string
          id: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id: string
        }
        Update: {
          conflict_resolved?: boolean
          created_at?: string
          device_id?: string | null
          distance_m?: number | null
          duration_sec?: number | null
          exercise_id?: string
          id?: string
          is_drop_set?: boolean
          is_failure?: boolean
          is_synced?: boolean
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          set_number?: number
          synced_at?: string | null
          tempo_actual?: string | null
          updated_at?: string
          weight_kg?: number | null
          workout_session_id?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      streaks: {
        Row: {
          broken_at: string | null
          created_at: string
          current_count: number
          freeze_remaining: number
          frozen_until: string | null
          id: string
          last_activity_date: string | null
          longest_count: number
          started_at: string | null
          streak_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          broken_at?: string | null
          created_at?: string
          current_count?: number
          freeze_remaining?: number
          frozen_until?: string | null
          id?: string
          last_activity_date?: string | null
          longest_count?: number
          started_at?: string | null
          streak_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          broken_at?: string | null
          created_at?: string
          current_count?: number
          freeze_remaining?: number
          frozen_until?: string | null
          id?: string
          last_activity_date?: string | null
          longest_count?: number
          started_at?: string | null
          streak_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_streaks_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_addons: {
        Row: {
          activated_at: string
          addon_type: string
          created_at: string
          currency: string
          deactivated_at: string | null
          id: string
          is_active: boolean
          price_cents: number
          quantity: number
          subscription_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string
          addon_type: string
          created_at?: string
          currency?: string
          deactivated_at?: string | null
          id?: string
          is_active?: boolean
          price_cents: number
          quantity?: number
          subscription_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          addon_type?: string
          created_at?: string
          currency?: string
          deactivated_at?: string | null
          id?: string
          is_active?: boolean
          price_cents?: number
          quantity?: number
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sa_sub"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_interval: string
          cancelled_at: string | null
          client_cap: number | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          discount_expires_at: string | null
          discount_pct: number | null
          discount_type: string | null
          id: string
          payment_method: string | null
          price_cents: number
          processor_subscription_id: string | null
          product: string
          renews_at: string | null
          status: string
          sub_pt_seats: number | null
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_interval?: string
          cancelled_at?: string | null
          client_cap?: number | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          discount_expires_at?: string | null
          discount_pct?: number | null
          discount_type?: string | null
          id?: string
          payment_method?: string | null
          price_cents: number
          processor_subscription_id?: string | null
          product: string
          renews_at?: string | null
          status?: string
          sub_pt_seats?: number | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_interval?: string
          cancelled_at?: string | null
          client_cap?: number | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          discount_expires_at?: string | null
          discount_pct?: number | null
          discount_type?: string | null
          id?: string
          payment_method?: string | null
          price_cents?: number
          processor_subscription_id?: string | null
          product?: string
          renews_at?: string | null
          status?: string
          sub_pt_seats?: number | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_subs_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          charge_id: string | null
          created_at: string
          event_id: string
          id: string
          purchased_at: string
          status: string
          ticket_code: string
          updated_at: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          charge_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          purchased_at?: string
          status?: string
          ticket_code: string
          updated_at?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          charge_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          purchased_at?: string
          status?: string
          ticket_code?: string
          updated_at?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_tickets_charge"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_tickets_event"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_tickets_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          badge_id: string
          context: Json | null
          created_at: string
          earned_at: string
          id: string
          shared_image_url: string | null
          user_id: string
        }
        Insert: {
          badge_id: string
          context?: Json | null
          created_at?: string
          earned_at?: string
          id?: string
          shared_image_url?: string | null
          user_id: string
        }
        Update: {
          badge_id?: string
          context?: Json | null
          created_at?: string
          earned_at?: string
          id?: string
          shared_image_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ub_badge"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ub_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_provider: string
          avatar_url: string | null
          consent_ai_training: boolean
          consent_analytics: boolean
          consent_marketing: boolean
          created_at: string
          deleted_at: string | null
          display_name: string
          email: string
          id: string
          is_deleted: boolean
          is_quarantined: boolean
          locale: string
          onboarding_completed: boolean
          phone: string | null
          quarantine_reason: string | null
          role: string
          timezone: string
          unit_system: string
          updated_at: string
        }
        Insert: {
          auth_provider?: string
          avatar_url?: string | null
          consent_ai_training?: boolean
          consent_analytics?: boolean
          consent_marketing?: boolean
          created_at?: string
          deleted_at?: string | null
          display_name: string
          email: string
          id: string
          is_deleted?: boolean
          is_quarantined?: boolean
          locale?: string
          onboarding_completed?: boolean
          phone?: string | null
          quarantine_reason?: string | null
          role: string
          timezone?: string
          unit_system?: string
          updated_at?: string
        }
        Update: {
          auth_provider?: string
          avatar_url?: string | null
          consent_ai_training?: boolean
          consent_analytics?: boolean
          consent_marketing?: boolean
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          email?: string
          id?: string
          is_deleted?: boolean
          is_quarantined?: boolean
          locale?: string
          onboarding_completed?: boolean
          phone?: string | null
          quarantine_reason?: string | null
          role?: string
          timezone?: string
          unit_system?: string
          updated_at?: string
        }
        Relationships: []
      }
      video_sessions: {
        Row: {
          booking_id: string
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          max_participants: number
          provider: string
          recording_url: string | null
          room_id: string
          room_url: string
          started_at: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          max_participants?: number
          provider: string
          recording_url?: string | null
          room_id: string
          room_url: string
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          max_participants?: number
          provider?: string
          recording_url?: string | null
          room_id?: string
          room_url?: string
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_vs_booking"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sessions: {
        Row: {
          booking_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          duration_min: number | null
          gym_id: string | null
          id: string
          is_pt_led: boolean
          logged_by_user_id: string
          program_day_id: string | null
          pt_notes: string | null
          rating: number | null
          scheduled_date: string | null
          session_notes: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          duration_min?: number | null
          gym_id?: string | null
          id?: string
          is_pt_led?: boolean
          logged_by_user_id: string
          program_day_id?: string | null
          pt_notes?: string | null
          rating?: number | null
          scheduled_date?: string | null
          session_notes?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          duration_min?: number | null
          gym_id?: string | null
          id?: string
          is_pt_led?: boolean
          logged_by_user_id?: string
          program_day_id?: string | null
          pt_notes?: string | null
          rating?: number | null
          scheduled_date?: string | null
          session_notes?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ws_booking"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ws_client"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ws_gym"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ws_logged_by"
            columns: ["logged_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ws_program_day"
            columns: ["program_day_id"]
            isOneToOne: false
            referencedRelation: "program_days"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      claim_client_invites: { Args: never; Returns: number }
      current_user_role: { Args: never; Returns: string }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      intake_progress: {
        Args: { p_client_id: string }
        Returns: {
          answered_sections: number
          state: string
          total_sections: number
          updated_at: string
        }[]
      }
      invite_client: {
        Args: { p_email: string; p_name?: string; p_tags?: string[] }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_client_record_owner: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      is_master_of: { Args: { p_pt_user_id: string }; Returns: boolean }
      is_my_pt: { Args: { p_pt_user_id: string }; Returns: boolean }
      is_pt_of_client: { Args: { p_client_id: string }; Returns: boolean }
      is_pt_of_user: { Args: { p_user_id: string }; Returns: boolean }
      log_account_event: {
        Args: { p_action: string; p_details?: Json }
        Returns: undefined
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      resend_invite: {
        Args: { p_client_id: string; p_email?: string }
        Returns: undefined
      }
      revoke_invite: { Args: { p_client_id: string }; Returns: undefined }
      set_client_state: {
        Args: { p_client_id: string; p_state: string }
        Returns: undefined
      }
      set_initial_role: { Args: { p_role: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      submit_intake: {
        Args: { p_intake_id: string; p_responses: Json }
        Returns: undefined
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      uuid_v7: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
