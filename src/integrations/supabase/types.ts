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
          created_at: string
          cta_type: string
          description: string | null
          extra_instructions: string | null
          id: string
          key_selling_points: string | null
          name: string
          num_emails: number
          personalization_level: string
          sender_company: string | null
          sender_name: string | null
          sender_title: string | null
          updated_at: string
          user_id: string
          what_selling: string | null
          word_count: number
        }
        Insert: {
          created_at?: string
          cta_type?: string
          description?: string | null
          extra_instructions?: string | null
          id?: string
          key_selling_points?: string | null
          name: string
          num_emails?: number
          personalization_level?: string
          sender_company?: string | null
          sender_name?: string | null
          sender_title?: string | null
          updated_at?: string
          user_id: string
          what_selling?: string | null
          word_count?: number
        }
        Update: {
          created_at?: string
          cta_type?: string
          description?: string | null
          extra_instructions?: string | null
          id?: string
          key_selling_points?: string | null
          name?: string
          num_emails?: number
          personalization_level?: string
          sender_company?: string | null
          sender_name?: string | null
          sender_title?: string | null
          updated_at?: string
          user_id?: string
          what_selling?: string | null
          word_count?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
