export interface CheckoutRequest {
  shippingInfo: {
    fullName: string;
    phone: string;
    email: string;
    addressLine1: string;
    addressLine2?: string;
    landmark?: string;
    city: string;
    province?: string;
    postalCode: string;
    country?: string;
  };
  paymentMethod: "cod" | "esewa" | "khalti" | "bank_transfer";
  transactionNumber?: string;
  customerNote?: string;
  discountCode?: string;
  /** Cart item IDs to check out. If omitted, the entire cart is checked out. (Logged-in users only.) */
  cartItemIds?: number[];
  /**
   * Items to check out for GUEST checkout (no auth token).
   * Logged-in users ignore this and use their DB cart instead.
   * `colorId` is required when the product has color variants.
   */
  items?: { productId: number; quantity: number; colorId?: number }[];
}

export interface UpdateOrderStatusRequest {
  status:
    | "pending"
    | "confirmed"
    | "processing"
    | "shipped"
    | "delivered"
    | "cancelled";
  adminNote?: string;
}

export interface UpdatePaymentStatusRequest {
  paymentStatus: "pending" | "paid" | "failed";
  adminNote?: string;
}

export interface OrderResponse {
  id: number;
  orderNumber: string;
  userId: number | null;
  status: string;
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  total: number;
  shippingFullName: string;
  shippingPhone: string;
  shippingEmail: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingLandmark: string | null;
  shippingCity: string;
  shippingProvince: string | null;
  shippingPostalCode: string;
  shippingCountry: string;
  paymentMethod: string;
  paymentStatus: string;
  transactionNumber: string | null;
  customerNote: string | null;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemResponse[];
}

export interface OrderItemResponse {
  id: number;
  orderId: number;
  productId: number;
  productName: string;
  productSku: string | null;
  productImage: string | null;
  colorName: string | null;
  colorId: number | null;
  price: number;
  quantity: number;
  subtotal: number;
  createdAt: Date;
}
