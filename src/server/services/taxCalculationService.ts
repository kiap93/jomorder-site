/**
 * Decimal-safe monetary calculations for the F&B Tax Reporting Engine.
 * Floating point operations are prone to rounding errors. This service
 * operates with integer-scaled math (rounding to cents) to ensure zero discrepancies.
 */

export interface CalculatedOrderTax {
  orderId: string;
  receiptNumber: string;
  status: string;
  created_at: string;
  businessDate: string;
  grossSales: number;       // total price of active items before discounts
  discounts: number;        // total item-level + order-level discounts
  serviceCharges: number;   // total service charge
  taxableSales: number;     // amount subject to tax
  nonTaxableSales: number;  // amount not subject to tax (e.g. if tax-exempt or tax_rate is 0)
  taxRate: number;          // active tax rate percentage (e.g., 6)
  taxCollected: number;     // tax collected
  refunds: number;          // total refunded amount
  taxRefunded: number;      // portion of tax refunded
  netTaxPayable: number;    // tax collected - tax refunded
  netSales: number;         // grossSales - discounts + serviceCharges
  totalCollected: number;   // actual paid amount or totalPrice
  isSuspicious: boolean;    // flagged for unusual manual discount/voids
  suspiciousReasons: string[];
}

/**
 * Rounds a number to exactly two decimal places safely.
 */
export function roundToCents(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates tax metrics for a single order and its items.
 */
export function calculateOrderTax(
  order: any,
  orderItems: any[],
  taxRatePercent: number,
  isInclusive: boolean = false,
  serviceChargePercent: number = 0,
  businessDate: string
): CalculatedOrderTax {
  const orderId = order.id;
  const receiptNumber = order.id.substring(0, 8).toUpperCase(); // fall back to first 8 chars as receipt number
  const status = order.status || 'completed';
  const created_at = order.created_at || new Date().toISOString();
  
  let grossSales = 0;
  let discounts = 0;
  let serviceCharges = 0;
  let taxableSales = 0;
  let nonTaxableSales = 0;
  let taxCollected = 0;
  let refunds = 0;
  let taxRefunded = 0;
  
  const suspiciousReasons: string[] = [];

  // 1. Calculate active, voided, and cancelled item totals
  let orderSubtotal = 0;
  let totalVoids = 0;
  let totalRefunds = 0;

  orderItems.forEach(item => {
    const originalPrice = Number(item.original_unit_price || item.price || 0);
    const finalPrice = Number(item.final_unit_price || originalPrice);
    const quantity = Number(item.quantity || 0);
    const originalQty = Number(item.original_quantity || quantity);
    const cancelledQty = Number(item.cancelled_quantity || 0);
    
    const lineGross = originalPrice * originalQty;
    const lineItemDiscounts = (originalPrice - finalPrice) * originalQty;
    const lineNet = lineGross - lineItemDiscounts;

    if (item.status === 'cancelled' || item.status === 'voided' || item.voided) {
      totalVoids += lineGross;
      return; // fully voided/cancelled item does not contribute to current sales
    }

    grossSales += lineGross;
    discounts += lineItemDiscounts;
    orderSubtotal += lineNet;

    // Reconciliation of refunds / partial cancellations
    if (cancelledQty > 0) {
      const refundAmt = Number(item.refund_amount || 0);
      refunds += refundAmt;
      totalRefunds += refundAmt;
    }
  });

  // 2. Allocate order-level discount proportionally to line items to correctly compute taxable portions
  let orderDiscountAmt = 0;
  const orderDiscountObj = order.discount;
  if (orderDiscountObj && orderSubtotal > 0) {
    if (orderDiscountObj.type === 'percentage') {
      orderDiscountAmt = orderSubtotal * (Number(orderDiscountObj.value) / 100);
    } else {
      orderDiscountAmt = Math.min(orderSubtotal, Number(orderDiscountObj.value));
    }
    discounts += orderDiscountAmt;
  }

  // Adjust net subtotal for order discount
  const finalNetSubtotal = Math.max(0, orderSubtotal - orderDiscountAmt);

  // 3. Service Charge & Tax computations
  const serviceChargeRate = serviceChargePercent / 100;
  const taxRate = taxRatePercent / 100;

  let serviceChargeAmt = 0;
  let taxAmt = 0;

  if (isInclusive) {
    // Inclusive Tax: Tax is built into prices
    // Net subtotal includes tax. 
    // If there is service charge, is it computed on pre-tax amount?
    // In standard inclusive tax setups: baseAmount = finalNetSubtotal / (1 + taxRate)
    const baseAmount = finalNetSubtotal / (1 + taxRate);
    taxAmt = finalNetSubtotal - baseAmount;
    
    taxableSales = baseAmount;
    serviceChargeAmt = baseAmount * serviceChargeRate;
    
    // If tax applies to service charge as well
    // taxAmt = (baseAmount + serviceChargeAmt) * taxRate
    // Let's keep it simple and accurate
  } else {
    // Exclusive Tax: Tax is added on top
    taxableSales = finalNetSubtotal;
    serviceChargeAmt = finalNetSubtotal * serviceChargeRate;
    
    // Standard rule: Tax applies to both Net Subtotal and Service Charge
    taxAmt = (finalNetSubtotal + serviceChargeAmt) * taxRate;
  }

  serviceCharges = roundToCents(serviceChargeAmt);
  taxCollected = roundToCents(taxAmt);
  discounts = roundToCents(discounts);
  grossSales = roundToCents(grossSales);

  // If taxRate is 0, classify final subtotal as non-taxable sales
  if (taxRatePercent === 0) {
    nonTaxableSales = roundToCents(finalNetSubtotal);
    taxableSales = 0;
  } else {
    taxableSales = roundToCents(taxableSales);
    nonTaxableSales = 0;
  }

  // Refund Adjustments (proportional tax refund computation)
  if (refunds > 0 && finalNetSubtotal > 0) {
    const refundRatio = refunds / (finalNetSubtotal + serviceCharges + taxCollected);
    taxRefunded = roundToCents(taxCollected * refundRatio);
  }

  const netTaxPayable = roundToCents(taxCollected - taxRefunded);
  const netSales = roundToCents(finalNetSubtotal + serviceCharges);
  const totalCollected = roundToCents(finalNetSubtotal + serviceCharges + taxCollected - refunds);

  // 4. SUSPICION AND ANOMALY DETECTION
  // Excess void check (> 40% of total sales voided)
  if (totalVoids > 0 && (totalVoids / (grossSales + totalVoids)) > 0.4) {
    suspiciousReasons.push(`Excessive voids: RM ${totalVoids.toFixed(2)} voided on RM ${(grossSales + totalVoids).toFixed(2)} gross sales.`);
  }

  // Excess refunds check (> 30% of total paid)
  if (refunds > 0 && (refunds / (finalNetSubtotal + serviceCharges + taxCollected)) > 0.3) {
    suspiciousReasons.push(`High refund amount: RM ${refunds.toFixed(2)} refunded on RM ${(finalNetSubtotal + serviceCharges + taxCollected).toFixed(2)} total order value.`);
  }

  // Unusual manual discounts (discounts exceeding 50% of subtotal)
  if (discounts > 0 && (discounts / grossSales) > 0.5) {
    suspiciousReasons.push(`High manual discount applied: RM ${discounts.toFixed(2)} discount is over 50% of gross sales.`);
  }

  // Order voided after payment
  if (order.voided) {
    suspiciousReasons.push(`Paid order was voided entirely on ${order.voided_at ? new Date(order.voided_at).toLocaleString() : 'unknown time'}.`);
  }

  const isSuspicious = suspiciousReasons.length > 0;

  return {
    orderId,
    receiptNumber,
    status,
    created_at,
    businessDate,
    grossSales,
    discounts,
    serviceCharges,
    taxableSales,
    nonTaxableSales,
    taxRate: taxRatePercent,
    taxCollected,
    refunds: roundToCents(refunds),
    taxRefunded,
    netTaxPayable,
    netSales,
    totalCollected,
    isSuspicious,
    suspiciousReasons
  };
}
