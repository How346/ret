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
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          store_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          store_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          name: string
          phone: string | null
          store_id: string | null
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          store_id?: string | null
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      held_bills: {
        Row: {
          cashier_id: string | null
          created_at: string
          id: string
          label: string | null
          payload: Json
          store_id: string | null
        }
        Insert: {
          cashier_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          payload: Json
          store_id?: string | null
        }
        Update: {
          cashier_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          payload?: Json
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "held_bills_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      licenses: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          issued_at: string
          key: string
          notes: string | null
          plan: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          issued_at?: string
          key: string
          notes?: string | null
          plan?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          issued_at?: string
          key?: string
          notes?: string | null
          plan?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      printer_profiles: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          barcode: string | null
          created_at: string
          id: string
          label: string | null
          mrp: number
          product_id: string
          purchase_price: number
          sale_price: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: string
          label?: string | null
          mrp?: number
          product_id: string
          purchase_price?: number
          sale_price?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: string
          label?: string | null
          mrp?: number
          product_id?: string
          purchase_price?: number
          sale_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          created_at: string
          gst_rate: number
          hsn_code: string | null
          id: string
          image_url: string | null
          is_active: boolean
          low_stock_alert: number
          mrp: number
          name: string
          purchase_price: number
          sale_price: number
          sku: string | null
          stock: number
          store_id: string | null
          unit: string
          updated_at: string
          wholesale_price: number
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_alert?: number
          mrp?: number
          name: string
          purchase_price?: number
          sale_price?: number
          sku?: string | null
          stock?: number
          store_id?: string | null
          unit?: string
          updated_at?: string
          wholesale_price?: number
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_alert?: number
          mrp?: number
          name?: string
          purchase_price?: number
          sale_price?: number
          sku?: string | null
          stock?: number
          store_id?: string | null
          unit?: string
          updated_at?: string
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          is_blocked: boolean
          store_id: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          is_blocked?: boolean
          store_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_blocked?: boolean
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          barcode: string | null
          cost: number
          mrp: number
          sale_price: number
          gst_amount: number
          gst_rate: number
          hsn_code: string | null
          id: string
          product_id: string | null
          product_name: string
          purchase_id: string
          qty: number
          total: number
        }
        Insert: {
          barcode?: string | null
          cost?: number
          mrp?: number
          sale_price?: number
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          product_id?: string | null
          product_name: string
          purchase_id: string
          qty?: number
          total?: number
        }
        Update: {
          barcode?: string | null
          cost?: number
          mrp?: number
          sale_price?: number
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          product_id?: string | null
          product_name?: string
          purchase_id?: string
          qty?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          bill_date: string
          bill_no: string | null
          created_at: string
          created_by: string | null
          discount: number
          id: string
          notes: string | null
          paid: number
          payment_mode: string | null
          store_id: string | null
          subtotal: number
          supplier_id: string | null
          supplier_name: string | null
          tax_amount: number
          total: number
          updated_at: string
        }
        Insert: {
          bill_date?: string
          bill_no?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          notes?: string | null
          paid?: number
          payment_mode?: string | null
          store_id?: string | null
          subtotal?: number
          supplier_id?: string | null
          supplier_name?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Update: {
          bill_date?: string
          bill_no?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          notes?: string | null
          paid?: number
          payment_mode?: string | null
          store_id?: string | null
          subtotal?: number
          supplier_id?: string | null
          supplier_name?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          discount: number
          gst_amount: number
          gst_rate: number
          hsn_code: string | null
          id: string
          price: number
          product_id: string | null
          product_name: string
          qty: number
          sale_id: string
          total: number
        }
        Insert: {
          discount?: number
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          price: number
          product_id?: string | null
          product_name: string
          qty: number
          sale_id: string
          total: number
        }
        Update: {
          discount?: number
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          price?: number
          product_id?: string | null
          product_name?: string
          qty?: number
          sale_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cashier_id: string | null
          cgst: number
          created_at: string
          customer_id: string | null
          discount: number
          edited_by: string | null
          id: string
          igst: number
          invoice_no: string
          notes: string | null
          paid_card: number
          paid_cash: number
          paid_upi: number
          sgst: number
          status: string
          store_id: string | null
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          cashier_id?: string | null
          cgst?: number
          created_at?: string
          customer_id?: string | null
          discount?: number
          edited_by?: string | null
          id?: string
          igst?: number
          invoice_no: string
          notes?: string | null
          paid_card?: number
          paid_cash?: number
          paid_upi?: number
          sgst?: number
          status?: string
          store_id?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          cashier_id?: string | null
          cgst?: number
          created_at?: string
          customer_id?: string | null
          discount?: number
          edited_by?: string | null
          id?: string
          igst?: number
          invoice_no?: string
          notes?: string | null
          paid_card?: number
          paid_cash?: number
          paid_upi?: number
          sgst?: number
          status?: string
          store_id?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          change: number
          created_at: string
          id: string
          product_id: string
          reason: string
          ref_id: string | null
        }
        Insert: {
          change: number
          created_at?: string
          id?: string
          product_id: string
          reason: string
          ref_id?: string | null
        }
        Update: {
          change?: number
          created_at?: string
          id?: string
          product_id?: string
          reason?: string
          ref_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address: string | null
          auto_print: boolean
          bank_account: string | null
          bank_ifsc: string | null
          bank_name: string | null
          bill_no_format: string
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          invoice_footer: string | null
          invoice_prefix: string
          logo_url: string | null
          paper_size: string
          phone: string | null
          print_copies: number
          receipt_bold: boolean
          receipt_font_size: number
          receipt_line_height: number
          receipt_margin_bottom: number
          receipt_margin_left: number
          receipt_margin_right: number
          receipt_margin_top: number
          shop_name: string
          show_footer: boolean
          show_gst_breakdown: boolean
          show_gstin: boolean
          show_logo: boolean
          singleton: boolean
          state: string | null
          state_code: string | null
          terms: string | null
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          address?: string | null
          auto_print?: boolean
          bank_account?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          bill_no_format?: string
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          invoice_footer?: string | null
          invoice_prefix?: string
          logo_url?: string | null
          paper_size?: string
          phone?: string | null
          print_copies?: number
          receipt_bold?: boolean
          receipt_font_size?: number
          receipt_line_height?: number
          receipt_margin_bottom?: number
          receipt_margin_left?: number
          receipt_margin_right?: number
          receipt_margin_top?: number
          shop_name?: string
          show_footer?: boolean
          show_gst_breakdown?: boolean
          show_gstin?: boolean
          show_logo?: boolean
          singleton?: boolean
          state?: string | null
          state_code?: string | null
          terms?: string | null
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          address?: string | null
          auto_print?: boolean
          bank_account?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          bill_no_format?: string
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          invoice_footer?: string | null
          invoice_prefix?: string
          logo_url?: string | null
          paper_size?: string
          phone?: string | null
          print_copies?: number
          receipt_bold?: boolean
          receipt_font_size?: number
          receipt_line_height?: number
          receipt_margin_bottom?: number
          receipt_margin_left?: number
          receipt_margin_right?: number
          receipt_margin_top?: number
          shop_name?: string
          show_footer?: boolean
          show_gst_breakdown?: boolean
          show_gstin?: boolean
          show_logo?: boolean
          singleton?: boolean
          state?: string | null
          state_code?: string | null
          terms?: string | null
          updated_at?: string
          upi_id?: string | null
        }
        Relationships: []
      }
      stores: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          name: string
          phone: string | null
          state: string | null
          store_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          state?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          state?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_store_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_invoice_no: { Args: never; Returns: string }
      next_invoice_no_short: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "manager" | "cashier"
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
    Enums: {
      app_role: ["admin", "manager", "cashier"],
    },
  },
} as const
