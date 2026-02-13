export interface FulfillmentOrder {
  orderId: string;
  buyPlatform: string;
  buyUrl: string;
  buyPrice: number;
  sellPlatform: string;
  sellOrderId: string;
  buyerAddress: string;
  status: 'pending' | 'purchasing' | 'purchased' | 'shipped' | 'delivered' | 'failed';
}

export interface ShipmentTracking {
  carrier: string;
  trackingNumber: string;
  status: string;
  estimatedDelivery?: Date;
  events: Array<{
    date: Date;
    location: string;
    description: string;
  }>;
}
