// services/offer.ts

export type OfferType = "active" | "last24Hr" | "upcoming" | "expired" | null;

export interface OfferCalcInput {
  price: number;
  offer?: number | null;
  offerStart?: Date | string | null;
  offerEnd?: Date | string | null;
}

export interface OfferCalcResult {
  finalprice: number;
  offertype: OfferType;
  remainingtime: number | null;
  discountper: number;
}

export const calculateoffer = (product: OfferCalcInput): OfferCalcResult => {
  const now = new Date();

  let discountper = 0;
  let finalprice = product.price;
  let offertype: OfferType = null;
  let remainingtime: number | null = null;

  // No offer data → return base price
  if (!product.offer || !product.offerStart || !product.offerEnd) {
    return { finalprice, offertype, remainingtime, discountper };
  }

  const start = new Date(product.offerStart);
  const end = new Date(product.offerEnd);
  end.setHours(23, 59, 59, 999);
  const last24Hr = end.getTime() - 24 * 60 * 60 * 1000;

  // UPCOMING
  if (now.getTime() < start.getTime()) {
    offertype = "upcoming";
    remainingtime = start.getTime() - now.getTime();
  }

  // ACTIVE
  else if (now.getTime() >= start.getTime() && now.getTime() < last24Hr) {
    offertype = "active";
    discountper = product.offer;
    finalprice = Math.round(product.price * (1 - product.offer / 100));
  }

  // LAST 24 HOURS
  else if (now.getTime() >= last24Hr && now.getTime() <= end.getTime()) {
    offertype = "last24Hr";
    discountper = product.offer;
    remainingtime = end.getTime() - now.getTime();
    finalprice = Math.round(product.price * (1 - product.offer / 100));
  }

  // EXPIRED
  else {
    offertype = "expired";
  }

  return { finalprice, offertype, remainingtime, discountper };
};
