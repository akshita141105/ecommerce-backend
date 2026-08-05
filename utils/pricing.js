export const getEffectivePrice = (product) => {
    const now = new Date();

    const hasActiveOffer =
        product.offer > 0 &&
        (!product.offerStart || product.offerStart <= now) &&
        (!product.offerEnd || product.offerEnd >= now);

    if (!hasActiveOffer) return product.price;

    const discounted = product.price - (product.price * product.offer) / 100;
    return Math.round(discounted); // pura rupee tak round
    };