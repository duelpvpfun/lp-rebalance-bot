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
      bot_runtime_secrets: {
        Row: {
          key: string
          secret: string
          updated_at: string
        }
        Insert: {
          key: string
          secret: string
          updated_at?: string
        }
        Update: {
          key?: string
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      coin_activity: {
        Row: {
          amount_sol: number | null
          amount_usdc: number | null
          created_at: string
          id: number
          info: Json | null
          mint: string
          ok: boolean
          signature: string | null
          step: string
        }
        Insert: {
          amount_sol?: number | null
          amount_usdc?: number | null
          created_at?: string
          id?: number
          info?: Json | null
          mint: string
          ok: boolean
          signature?: string | null
          step: string
        }
        Update: {
          amount_sol?: number | null
          amount_usdc?: number | null
          created_at?: string
          id?: number
          info?: Json | null
          mint?: string
          ok?: boolean
          signature?: string | null
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_activity_mint_fkey"
            columns: ["mint"]
            isOneToOne: false
            referencedRelation: "coins"
            referencedColumns: ["mint"]
          },
        ]
      }
      coin_cycle_state: {
        Row: {
          attempts: number
          claim_guard_until: string | null
          claimed_usdc: number
          cooldown_until: string
          cycle_bucket: number
          cycle_start_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          mint: string
          phase: string
          spot_price: number
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_guard_until?: string | null
          claimed_usdc?: number
          cooldown_until?: string
          cycle_bucket?: number
          cycle_start_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          mint: string
          phase?: string
          spot_price?: number
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_guard_until?: string | null
          claimed_usdc?: number
          cooldown_until?: string
          cycle_bucket?: number
          cycle_start_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          mint?: string
          phase?: string
          spot_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_cycle_state_mint_fkey"
            columns: ["mint"]
            isOneToOne: true
            referencedRelation: "coins"
            referencedColumns: ["mint"]
          },
        ]
      }
      coin_wallets: {
        Row: {
          created_at: string
          encrypted_secret: Json
          mint: string
          public_key: string
          sol_buffer: number
        }
        Insert: {
          created_at?: string
          encrypted_secret: Json
          mint: string
          public_key: string
          sol_buffer?: number
        }
        Update: {
          created_at?: string
          encrypted_secret?: Json
          mint?: string
          public_key?: string
          sol_buffer?: number
        }
        Relationships: [
          {
            foreignKeyName: "coin_wallets_mint_fkey"
            columns: ["mint"]
            isOneToOne: true
            referencedRelation: "coins"
            referencedColumns: ["mint"]
          },
        ]
      }
      coins: {
        Row: {
          created_at: string
          deployer_wallet: string
          description: string | null
          enabled: boolean
          image_url: string | null
          launched_at: string | null
          mint: string
          name: string
          pair_address: string | null
          slug: string
          status: string
          symbol: string
          telegram_url: string | null
          twitter_url: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          deployer_wallet: string
          description?: string | null
          enabled?: boolean
          image_url?: string | null
          launched_at?: string | null
          mint: string
          name: string
          pair_address?: string | null
          slug: string
          status?: string
          symbol: string
          telegram_url?: string | null
          twitter_url?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          deployer_wallet?: string
          description?: string | null
          enabled?: boolean
          image_url?: string | null
          launched_at?: string | null
          mint?: string
          name?: string
          pair_address?: string | null
          slug?: string
          status?: string
          symbol?: string
          telegram_url?: string | null
          twitter_url?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      cycle_minute_runs: {
        Row: {
          created_at: string
          finished_at: string | null
          minute_key: number
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          minute_key: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          minute_key?: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cycle_runtime_state: {
        Row: {
          attempts: number
          claim_guard_until: string | null
          claimed_usdc: number
          cooldown_until: string
          cycle_minute_key: number | null
          cycle_start_at: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          phase: string
          spot_price: number
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_guard_until?: string | null
          claimed_usdc?: number
          cooldown_until?: string
          cycle_minute_key?: number | null
          cycle_start_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          phase?: string
          spot_price?: number
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_guard_until?: string | null
          claimed_usdc?: number
          cooldown_until?: string
          cycle_minute_key?: number | null
          cycle_start_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          phase?: string
          spot_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      pending_launches: {
        Row: {
          created_at: string
          deployer_wallet: string
          description: string | null
          dev_wallet: string
          expires_at: string
          gas_reserve_sol: number
          id: string
          image_url: string | null
          initial_buy_usdc: number
          last_error: string | null
          metadata_uri: string | null
          mint: string | null
          name: string
          slug: string
          status: string
          symbol: string
          telegram_url: string | null
          twitter_url: string | null
          website_url: string | null
        }
        Insert: {
          created_at?: string
          deployer_wallet: string
          description?: string | null
          dev_wallet: string
          expires_at: string
          gas_reserve_sol?: number
          id?: string
          image_url?: string | null
          initial_buy_usdc: number
          last_error?: string | null
          metadata_uri?: string | null
          mint?: string | null
          name: string
          slug: string
          status?: string
          symbol: string
          telegram_url?: string | null
          twitter_url?: string | null
          website_url?: string | null
        }
        Update: {
          created_at?: string
          deployer_wallet?: string
          description?: string | null
          dev_wallet?: string
          expires_at?: string
          gas_reserve_sol?: number
          id?: string
          image_url?: string | null
          initial_buy_usdc?: number
          last_error?: string | null
          metadata_uri?: string | null
          mint?: string | null
          name?: string
          slug?: string
          status?: string
          symbol?: string
          telegram_url?: string | null
          twitter_url?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_launches_dev_wallet_fkey"
            columns: ["dev_wallet"]
            isOneToOne: false
            referencedRelation: "pending_wallets"
            referencedColumns: ["public_key"]
          },
        ]
      }
      pending_wallets: {
        Row: {
          created_at: string
          encrypted_secret: Json
          public_key: string
        }
        Insert: {
          created_at?: string
          encrypted_secret: Json
          public_key: string
        }
        Update: {
          created_at?: string
          encrypted_secret?: Json
          public_key?: string
        }
        Relationships: []
      }
      stats_cache: {
        Row: {
          key: string
          payload: Json
          updated_at: string
        }
        Insert: {
          key: string
          payload: Json
          updated_at?: string
        }
        Update: {
          key?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_coin_cycle_lease: {
        Args: {
          p_bucket: number
          p_lease_seconds: number
          p_mint: string
          p_owner: string
        }
        Returns: {
          attempts: number
          claim_guard_until: string | null
          claimed_usdc: number
          cooldown_until: string
          cycle_bucket: number
          cycle_start_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          mint: string
          phase: string
          spot_price: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "coin_cycle_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      acquire_cycle_runtime_lease: {
        Args: { p_id: string; p_lease_seconds: number; p_owner: string }
        Returns: {
          attempts: number
          claim_guard_until: string | null
          claimed_usdc: number
          cooldown_until: string
          cycle_minute_key: number | null
          cycle_start_at: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          phase: string
          spot_price: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cycle_runtime_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      liquititty_fire_tick: { Args: never; Returns: number }
      reserve_coin_claim: {
        Args: {
          p_claimed_usdc: number
          p_guard_seconds: number
          p_mint: string
          p_owner: string
          p_spot_price: number
        }
        Returns: {
          attempts: number
          claim_guard_until: string | null
          claimed_usdc: number
          cooldown_until: string
          cycle_bucket: number
          cycle_start_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          mint: string
          phase: string
          spot_price: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "coin_cycle_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_cycle_claim: {
        Args: {
          p_claimed_usdc: number
          p_guard_seconds: number
          p_id: string
          p_owner: string
          p_spot_price: number
        }
        Returns: {
          attempts: number
          claim_guard_until: string | null
          claimed_usdc: number
          cooldown_until: string
          cycle_minute_key: number | null
          cycle_start_at: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          phase: string
          spot_price: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cycle_runtime_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
