// services/offer.js

export const calculateoffer = (product) => {
  const now = new Date();

  let discountper = 0;
  let finalprice = product.price;
  let offertype = null;
  let remainingtime = null;

  // ❗ No offer data → return base price
  if (!product.offer || !product.offerStart || !product.offerEnd) {
    return { finalprice, offertype, remainingtime, discountper };
  }

  const start = new Date(product.offerStart);
  const end = new Date(product.offerEnd);
  end.setHours(23, 59, 59, 999); 
  const last24Hr = end.getTime() - 24 * 60 * 60 * 1000;

  // UPCOMING
  if (now < start) {
    offertype = "upcoming";
    remainingtime = start - now;
  }

  // ACTIVE
  else if (now >= start && now < last24Hr) {
    offertype = "active";
    discountper = product.offer;
    finalprice = Math.round(
      product.price * (1 - product.offer / 100)
    );
  }

  // LAST 24 HOURS
  else if (now >= last24Hr && now <= end) {
    offertype = "last24Hr";
    discountper = product.offer;
    remainingtime = end - now;
    finalprice = Math.round(
      product.price * (1 - product.offer / 100)
    );
  }

  // EXPIRED
  else {
    offertype = "expired";
  }

  return { finalprice, offertype, remainingtime, discountper };
};