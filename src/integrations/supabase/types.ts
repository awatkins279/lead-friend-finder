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
      call_live_events: {
        Row: {
          call_id: string
          id: string
          kind: string
          meta: Json
          role: string | null
          text: string | null
          ts: string
          user_id: string
        }
        Insert: {
          call_id: string
          id?: string
          kind: string
          meta?: Json
          role?: string | null
          text?: string | null
          ts?: string
          user_id: string
        }
        Update: {
          call_id?: string
          id?: string
          kind?: string
          meta?: Json
          role?: string | null
          text?: string | null
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          created_at: string
          duration_sec: number | null
          ended_at: string | null
          from_number: string | null
          id: string
          lead_id: string
          list_id: string
          notes: string | null
          outcome: string | null
          phone_account_id: string | null
          recording_duration_sec: number | null
          recording_sid: string | null
          recording_url: string | null
          scorecard: Json | null
          started_at: string
          status: string
          to_number: string
          transcript: Json | null
          twilio_call_sid: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_sec?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          lead_id: string
          list_id: string
          notes?: string | null
          outcome?: string | null
          phone_account_id?: string | null
          recording_duration_sec?: number | null
          recording_sid?: string | null
          recording_url?: string | null
          scorecard?: Json | null
          started_at?: string
          status?: string
          to_number: string
          transcript?: Json | null
          twilio_call_sid?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          lead_id?: string
          list_id?: string
          notes?: string | null
          outcome?: string | null
          phone_account_id?: string | null
          recording_duration_sec?: number | null
          recording_sid?: string | null
          recording_url?: string | null
          scorecard?: Json | null
          started_at?: string
          status?: string
          to_number?: string
          transcript?: Json | null
          twilio_call_sid?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_phone_account_id_fkey"
            columns: ["phone_account_id"]
            isOneToOne: false
            referencedRelation: "user_phone_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          doc_id: string
          id: string
          list_id: string
          token_count: number | null
          user_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          doc_id: string
          id?: string
          list_id: string
          token_count?: number | null
          user_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          doc_id?: string
          id?: string
          list_id?: string
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_knowledge_chunks_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "coaching_knowledge_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_knowledge_docs: {
        Row: {
          chunk_count: number
          created_at: string
          error: string | null
          filename: string
          id: string
          list_id: string
          mime_type: string | null
          size_bytes: number | null
          status: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_count?: number
          created_at?: string
          error?: string | null
          filename: string
          id?: string
          list_id: string
          mime_type?: string | null
          size_bytes?: number | null
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_count?: number
          created_at?: string
          error?: string | null
          filename?: string
          id?: string
          list_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coaching_styles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          example_objection_handlers: Json
          hard_rules: string | null
          id: string
          is_default: boolean
          name: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          example_objection_handlers?: Json
          hard_rules?: string | null
          id?: string
          is_default?: boolean
          name: string
          system_prompt: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          example_objection_handlers?: Json
          hard_rules?: string | null
          id?: string
          is_default?: boolean
          name?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_costs: {
        Row: {
          action: string
          cost_per_unit: number
          description: string | null
          updated_at: string
        }
        Insert: {
          action: string
          cost_per_unit: number
          description?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          cost_per_unit?: number
          description?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          action: string
          amount: number
          created_at: string
          id: string
          note: string | null
          period_start: string
          user_id: string
        }
        Insert: {
          action: string
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          period_start: string
          user_id: string
        }
        Update: {
          action?: string
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          period_start?: string
          user_id?: string
        }
        Relationships: []
      }
      email_accounts: {
        Row: {
          auth_method: string | null
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          imap_host: string | null
          imap_port: number | null
          notes: string | null
          provider: string
          smtp_host: string | null
          smtp_port: number | null
          smtp_username: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_method?: string | null
          created_at?: string
          display_name?: string | null
          email_address: string
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          notes?: string | null
          provider?: string
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_method?: string | null
          created_at?: string
          display_name?: string | null
          email_address?: string
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          notes?: string | null
          provider?: string
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          first_name: string | null
          hubspot_status: string | null
          hubspot_sync_date: string | null
          id: string
          last_name: string | null
          linkedin_url: string | null
          org_annual_revenue: string | null
          org_description: string | null
          org_employee_count: string | null
          org_industry: string | null
          org_name: string | null
          org_technologies_used: string | null
          org_website_url: string | null
          phone: string | null
          profile_pic: string | null
          state: string | null
          title: string | null
          validation_status: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          hubspot_status?: string | null
          hubspot_sync_date?: string | null
          id: string
          last_name?: string | null
          linkedin_url?: string | null
          org_annual_revenue?: string | null
          org_description?: string | null
          org_employee_count?: string | null
          org_industry?: string | null
          org_name?: string | null
          org_technologies_used?: string | null
          org_website_url?: string | null
          phone?: string | null
          profile_pic?: string | null
          state?: string | null
          title?: string | null
          validation_status?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          hubspot_status?: string | null
          hubspot_sync_date?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          org_annual_revenue?: string | null
          org_description?: string | null
          org_employee_count?: string | null
          org_industry?: string | null
          org_name?: string | null
          org_technologies_used?: string | null
          org_website_url?: string | null
          phone?: string | null
          profile_pic?: string | null
          state?: string | null
          title?: string | null
          validation_status?: string | null
        }
        Relationships: []
      }
      list_call_configs: {
        Row: {
          consent_disclaimer: string
          created_at: string
          extra_instructions: string | null
          list_id: string
          objection_notes: string | null
          objectives: string | null
          personalization_level: string
          record_calls: boolean
          script_template: string | null
          tone: string
          updated_at: string
        }
        Insert: {
          consent_disclaimer?: string
          created_at?: string
          extra_instructions?: string | null
          list_id: string
          objection_notes?: string | null
          objectives?: string | null
          personalization_level?: string
          record_calls?: boolean
          script_template?: string | null
          tone?: string
          updated_at?: string
        }
        Update: {
          consent_disclaimer?: string
          created_at?: string
          extra_instructions?: string | null
          list_id?: string
          objection_notes?: string | null
          objectives?: string | null
          personalization_level?: string
          record_calls?: boolean
          script_template?: string | null
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_call_configs_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: true
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_leads: {
        Row: {
          call_script: Json | null
          created_at: string
          do_not_call: boolean
          email_body: string | null
          email_subject: string | null
          emails: Json | null
          lead_id: string
          list_id: string
          research: Json | null
          score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          call_script?: Json | null
          created_at?: string
          do_not_call?: boolean
          email_body?: string | null
          email_subject?: string | null
          emails?: Json | null
          lead_id: string
          list_id: string
          research?: Json | null
          score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          call_script?: Json | null
          created_at?: string
          do_not_call?: boolean
          email_body?: string | null
          email_subject?: string | null
          emails?: Json | null
          lead_id?: string
          list_id?: string
          research?: Json | null
          score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_leads_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          ai_copilot_enabled: boolean
          coaching_style_id: string | null
          created_at: string
          cta_type: string
          description: string | null
          extra_instructions: string | null
          id: string
          key_selling_points: string | null
          name: string
          num_emails: number
          personalization_level: string
          sdr_agent_id: string | null
          sdr_booking_url_override: string | null
          sdr_hard_rules_override: string | null
          sdr_mode_override: string | null
          sender_company: string | null
          sender_name: string | null
          sender_title: string | null
          updated_at: string
          user_id: string
          voicemail_audio_url: string | null
          what_selling: string | null
          word_count: number
        }
        Insert: {
          ai_copilot_enabled?: boolean
          coaching_style_id?: string | null
          created_at?: string
          cta_type?: string
          description?: string | null
          extra_instructions?: string | null
          id?: string
          key_selling_points?: string | null
          name: string
          num_emails?: number
          personalization_level?: string
          sdr_agent_id?: string | null
          sdr_booking_url_override?: string | null
          sdr_hard_rules_override?: string | null
          sdr_mode_override?: string | null
          sender_company?: string | null
          sender_name?: string | null
          sender_title?: string | null
          updated_at?: string
          user_id: string
          voicemail_audio_url?: string | null
          what_selling?: string | null
          word_count?: number
        }
        Update: {
          ai_copilot_enabled?: boolean
          coaching_style_id?: string | null
          created_at?: string
          cta_type?: string
          description?: string | null
          extra_instructions?: string | null
          id?: string
          key_selling_points?: string | null
          name?: string
          num_emails?: number
          personalization_level?: string
          sdr_agent_id?: string | null
          sdr_booking_url_override?: string | null
          sdr_hard_rules_override?: string | null
          sdr_mode_override?: string | null
          sender_company?: string | null
          sender_name?: string | null
          sender_title?: string | null
          updated_at?: string
          user_id?: string
          voicemail_audio_url?: string | null
          what_selling?: string | null
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "lists_coaching_style_id_fkey"
            columns: ["coaching_style_id"]
            isOneToOne: false
            referencedRelation: "coaching_styles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lists_sdr_agent_id_fkey"
            columns: ["sdr_agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          annual_price_cents: number
          created_at: string
          id: string
          monthly_credits: number
          name: string
          quarterly_price_cents: number
          sort_order: number
        }
        Insert: {
          annual_price_cents: number
          created_at?: string
          id: string
          monthly_credits: number
          name: string
          quarterly_price_cents: number
          sort_order?: number
        }
        Update: {
          annual_price_cents?: number
          created_at?: string
          id?: string
          monthly_credits?: number
          name?: string
          quarterly_price_cents?: number
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          call_to_action: string | null
          common_objections: string | null
          company_name: string | null
          competitors: string | null
          created_at: string
          elevenlabs_voice_id: string | null
          email: string | null
          full_name: string | null
          id: string
          ideal_customer: string | null
          pricing_notes: string | null
          product_description: string | null
          product_name: string | null
          product_value_props: string | null
          proof_points: string | null
          voicemail_settings: Json
        }
        Insert: {
          call_to_action?: string | null
          common_objections?: string | null
          company_name?: string | null
          competitors?: string | null
          created_at?: string
          elevenlabs_voice_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          ideal_customer?: string | null
          pricing_notes?: string | null
          product_description?: string | null
          product_name?: string | null
          product_value_props?: string | null
          proof_points?: string | null
          voicemail_settings?: Json
        }
        Update: {
          call_to_action?: string | null
          common_objections?: string | null
          company_name?: string | null
          competitors?: string | null
          created_at?: string
          elevenlabs_voice_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          ideal_customer?: string | null
          pricing_notes?: string | null
          product_description?: string | null
          product_name?: string | null
          product_value_props?: string | null
          proof_points?: string | null
          voicemail_settings?: Json
        }
        Relationships: []
      }
      saved_searches: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      scoring_job_batches: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          job_id: string
          lead_ids: string[]
          results: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          job_id: string
          lead_ids: string[]
          results?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          job_id?: string
          lead_ids?: string[]
          results?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_job_batches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "scoring_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_jobs: {
        Row: {
          completed_batches: number
          context: string
          created_at: string
          error: string | null
          failed_batches: number
          id: string
          scored_leads: number
          status: string
          total_batches: number
          total_leads: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_batches?: number
          context: string
          created_at?: string
          error?: string | null
          failed_batches?: number
          id?: string
          scored_leads?: number
          status?: string
          total_batches?: number
          total_leads?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_batches?: number
          context?: string
          created_at?: string
          error?: string | null
          failed_batches?: number
          id?: string
          scored_leads?: number
          status?: string
          total_batches?: number
          total_leads?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sdr_agents: {
        Row: {
          booking_url: string | null
          confidence_threshold: number
          created_at: string
          email_account_id: string | null
          extra_instructions: string | null
          formality: number
          handoff_triggers: string | null
          hard_rules: string | null
          id: string
          inbox_account_id: string | null
          inbox_email: string | null
          inbox_provider: string | null
          key_differentiators: string | null
          mode: string
          name: string
          response_speed: string
          sdr_display_name: string | null
          signature: string | null
          tone: string
          updated_at: string
          user_id: string
          what_selling: string | null
        }
        Insert: {
          booking_url?: string | null
          confidence_threshold?: number
          created_at?: string
          email_account_id?: string | null
          extra_instructions?: string | null
          formality?: number
          handoff_triggers?: string | null
          hard_rules?: string | null
          id?: string
          inbox_account_id?: string | null
          inbox_email?: string | null
          inbox_provider?: string | null
          key_differentiators?: string | null
          mode?: string
          name: string
          response_speed?: string
          sdr_display_name?: string | null
          signature?: string | null
          tone?: string
          updated_at?: string
          user_id: string
          what_selling?: string | null
        }
        Update: {
          booking_url?: string | null
          confidence_threshold?: number
          created_at?: string
          email_account_id?: string | null
          extra_instructions?: string | null
          formality?: number
          handoff_triggers?: string | null
          hard_rules?: string | null
          id?: string
          inbox_account_id?: string | null
          inbox_email?: string | null
          inbox_provider?: string | null
          key_differentiators?: string | null
          mode?: string
          name?: string
          response_speed?: string
          sdr_display_name?: string | null
          signature?: string | null
          tone?: string
          updated_at?: string
          user_id?: string
          what_selling?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sdr_agents_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_conversations: {
        Row: {
          agent_id: string | null
          company: string | null
          created_at: string
          email_account_id: string | null
          id: string
          intent: string | null
          intent_confidence: number | null
          last_direction: string
          last_message_at: string
          lead_email: string
          lead_id: string | null
          lead_name: string | null
          list_id: string | null
          meeting_booked_at: string | null
          status: string
          subject: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          company?: string | null
          created_at?: string
          email_account_id?: string | null
          id?: string
          intent?: string | null
          intent_confidence?: number | null
          last_direction?: string
          last_message_at?: string
          lead_email: string
          lead_id?: string | null
          lead_name?: string | null
          list_id?: string | null
          meeting_booked_at?: string | null
          status?: string
          subject?: string | null
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          company?: string | null
          created_at?: string
          email_account_id?: string | null
          id?: string
          intent?: string | null
          intent_confidence?: number | null
          last_direction?: string
          last_message_at?: string
          lead_email?: string
          lead_id?: string | null
          lead_name?: string | null
          list_id?: string | null
          meeting_booked_at?: string | null
          status?: string
          subject?: string | null
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_conversations_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_conversations_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_knowledge_chunks: {
        Row: {
          agent_id: string
          chunk_index: number
          content: string
          created_at: string
          doc_id: string
          id: string
          token_count: number | null
          user_id: string
        }
        Insert: {
          agent_id: string
          chunk_index: number
          content: string
          created_at?: string
          doc_id: string
          id?: string
          token_count?: number | null
          user_id: string
        }
        Update: {
          agent_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          doc_id?: string
          id?: string
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_knowledge_chunks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_knowledge_chunks_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "sdr_knowledge_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_knowledge_docs: {
        Row: {
          agent_id: string
          chunk_count: number
          created_at: string
          error: string | null
          filename: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          status: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          chunk_count?: number
          created_at?: string
          error?: string | null
          filename: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          chunk_count?: number
          created_at?: string
          error?: string | null
          filename?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_knowledge_docs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_message_attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          message_id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          message_id: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          message_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "sdr_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_messages: {
        Row: {
          agent_id: string | null
          ai_generated: boolean
          body_html: string | null
          body_text: string | null
          cc_emails: string[]
          conversation_id: string
          created_at: string
          direction: string
          email_references: string[]
          from_email: string
          from_name: string | null
          id: string
          in_reply_to: string | null
          message_id: string | null
          raw: Json | null
          received_at: string | null
          sent_at: string | null
          snippet: string | null
          status: string
          subject: string | null
          to_emails: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          ai_generated?: boolean
          body_html?: string | null
          body_text?: string | null
          cc_emails?: string[]
          conversation_id: string
          created_at?: string
          direction: string
          email_references?: string[]
          from_email: string
          from_name?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          raw?: Json | null
          received_at?: string | null
          sent_at?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
          to_emails?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          ai_generated?: boolean
          body_html?: string | null
          body_text?: string | null
          cc_emails?: string[]
          conversation_id?: string
          created_at?: string
          direction?: string
          email_references?: string[]
          from_email?: string
          from_name?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          raw?: Json | null
          received_at?: string | null
          sent_at?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
          to_emails?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sdr_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string
          environment: string
          id: string
          next_billing_date: string | null
          plan_id: string | null
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          environment?: string
          id?: string
          next_billing_date?: string | null
          plan_id?: string | null
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          environment?: string
          id?: string
          next_billing_date?: string | null
          plan_id?: string | null
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_phone_accounts: {
        Row: {
          created_at: string
          credentials: Json
          from_number: string | null
          id: string
          is_default: boolean
          label: string
          provider: string
          twilio_account_sid: string | null
          twilio_api_key_secret: string | null
          twilio_api_key_sid: string | null
          twilio_auth_token: string | null
          twilio_twiml_app_sid: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credentials?: Json
          from_number?: string | null
          id?: string
          is_default?: boolean
          label?: string
          provider?: string
          twilio_account_sid?: string | null
          twilio_api_key_secret?: string | null
          twilio_api_key_sid?: string | null
          twilio_auth_token?: string | null
          twilio_twiml_app_sid?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credentials?: Json
          from_number?: string | null
          id?: string
          is_default?: boolean
          label?: string
          provider?: string
          twilio_account_sid?: string | null
          twilio_api_key_secret?: string | null
          twilio_api_key_sid?: string | null
          twilio_auth_token?: string | null
          twilio_twiml_app_sid?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voicemail_logs: {
        Row: {
          audio_seconds: number | null
          call_id: string | null
          created_at: string
          error: string | null
          id: string
          lead_id: string
          list_id: string
          script: string
          status: string
          user_id: string
          voice_id: string | null
        }
        Insert: {
          audio_seconds?: number | null
          call_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          list_id: string
          script: string
          status?: string
          user_id: string
          voice_id?: string | null
        }
        Update: {
          audio_seconds?: number | null
          call_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          list_id?: string
          script?: string
          status?: string
          user_id?: string
          voice_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_scoring_batch: {
        Args: { p_job_id: string }
        Returns: {
          id: string
          lead_ids: string[]
        }[]
      }
      finalize_scoring_job: {
        Args: { p_job_id: string }
        Returns: {
          completed_batches: number
          failed_batches: number
          scored_leads: number
          status: string
          total_batches: number
          total_leads: number
        }[]
      }
      get_credit_summary: {
        Args: { _user_id: string }
        Returns: {
          allowance: number
          by_action: Json
          is_admin: boolean
          period_end: string
          period_start: string
          plan_id: string
          plan_name: string
          remaining: number
          used: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      spend_credits: {
        Args: {
          _action: string
          _amount: number
          _note?: string
          _user_id: string
        }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "customer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "customer"],
    },
  },
} as const
