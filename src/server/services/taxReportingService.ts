import { supabaseAdmin } from "./dbService";
import { calculateOrderTax, roundToCents, CalculatedOrderTax } from "./taxCalculationService";

export interface TaxReportSummary {
  business_id: string;
  reportType: 'daily' | 'monthly' | 'custom';
  startDate: string;
  endDate: string;
  totalOrdersCount: number;
  grossSalesSum: number;
  discountsSum: number;
  serviceChargesSum: number;
  taxableSalesSum: number;
  nonTaxableSalesSum: number;
  taxCollectedSum: number;
  refundsSum: number;
  taxRefundedSum: number;
  netTaxPayableSum: number;
  netSalesSum: number;
  totalCollectedSum: number;
  rateBreakdown: Record<number, {
    taxableAmount: number;
    taxCollected: number;
    taxRefunded: number;
    netTax: number;
  }>;
  anomalies: Array<{
    orderId: string;
    receiptNumber: string;
    reasons: string[];
    timestamp: string;
  }>;
  details: CalculatedOrderTax[];
}

export interface BusinessConfig {
  timezone: string;
  business_day_close_time: string;
  tax_rate: number;
  tax_inclusive: boolean;
  service_charge: number;
}

/**
 * Parses UTC ISO timestamps to local timezone and outputs the date and hour.
 */
function getLocalDateTime(utcString: string, timezone: string): { dateStr: string; hour: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date(utcString));
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    return {
      dateStr: `${year}-${month}-${day}`,
      hour
    };
  } catch (err) {
    const date = new Date(utcString);
    const dateStr = date.toISOString().split('T')[0];
    const hour = date.getUTCHours();
    return { dateStr, hour };
  }
}

/**
 * Resolves the business date considering overnight closing hours.
 * If closeTimeStr is '04:00' and an order is placed at 2:30 AM on July 14,
 * it falls back to the July 13 business day.
 */
export function getBusinessDate(utcString: string, timezone: string, closeTimeStr: string = '04:00'): string {
  const { dateStr, hour } = getLocalDateTime(utcString, timezone);
  const closeHour = parseInt(closeTimeStr.split(':')[0], 10) || 4;

  if (hour < closeHour) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

/**
 * Fetches restaurant config settings, including timezone, business day closing time, tax rate.
 */
export async function getRestaurantConfig(restaurantId: string, supabaseClient?: any): Promise<BusinessConfig> {
  const client = supabaseClient || supabaseAdmin;
  const defaultSettings: BusinessConfig = {
    timezone: 'Asia/Kuala_Lumpur',
    business_day_close_time: '04:00',
    tax_rate: 6.0,
    tax_inclusive: false,
    service_charge: 10.0
  };

  try {
    const { data: restaurant, error: restErr } = await client
      .from('restaurants')
      .select('*, business_settings(*), tax_profiles(*)')
      .eq('id', restaurantId)
      .maybeSingle();

    if (restErr || !restaurant) {
      return defaultSettings;
    }

    const businessSettings = (restaurant.business_settings && restaurant.business_settings[0]) || {};
    
    // Check if tax_profiles has any active rule
    const activeTaxProfile = restaurant.tax_profiles?.find((tp: any) => tp.is_active);

    return {
      timezone: businessSettings.timezone || restaurant.timezone || defaultSettings.timezone,
      business_day_close_time: businessSettings.business_day_close_time || '04:00',
      tax_rate: activeTaxProfile ? Number(activeTaxProfile.tax_rate) : (businessSettings.tax_rate || restaurant.sst || defaultSettings.tax_rate),
      tax_inclusive: activeTaxProfile ? Boolean(activeTaxProfile.is_inclusive) : (businessSettings.tax_inclusive || false),
      service_charge: Number(restaurant.serviceCharge !== undefined ? restaurant.serviceCharge : (restaurant.service_charge || defaultSettings.service_charge))
    };
  } catch (err) {
    console.warn("[TaxReportingService] Error getting restaurant config, fallback applied:", err);
    return defaultSettings;
  }
}

/**
 * Primary engine compiler aggregating complete tax metrics.
 */
export async function generateTaxReport(
  restaurantId: string,
  startDateStr: string, // YYYY-MM-DD
  endDateStr: string,   // YYYY-MM-DD
  reportType: 'daily' | 'monthly' | 'custom',
  supabaseClient?: any
): Promise<TaxReportSummary> {
  const config = await getRestaurantConfig(restaurantId, supabaseClient);
  const client = supabaseClient || supabaseAdmin;

  // Buffer date selection to catch overnight shifts
  // Query 1 day before and 1 day after the calendar range to ensure zero leakage
  const startBufferDate = new Date(startDateStr);
  startBufferDate.setDate(startBufferDate.getDate() - 1);
  const endBufferDate = new Date(endDateStr);
  endBufferDate.setDate(endBufferDate.getDate() + 2);

  const startUtcIso = `${startBufferDate.toISOString().split('T')[0]}T00:00:00.000Z`;
  const endUtcIso = `${endBufferDate.toISOString().split('T')[0]}T23:59:59.999Z`;

  // Fetch orders
  const { data: orders, error: ordersErr } = await client
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', startUtcIso)
    .lte('created_at', endUtcIso);

  if (ordersErr) {
    throw new Error(`Failed to fetch orders: ${ordersErr.message}`);
  }

  // Filter and compute business date
  const filteredOrders = (orders || []).filter((order: any) => {
    // Rely on PAID, COMPLETED, or fully VOIDED/REFUNDED transactions
    const isValidStatus = ['completed', 'paid'].includes(order.status) || order.voided === true;
    if (!isValidStatus) return false;

    const bDate = getBusinessDate(order.created_at, config.timezone, config.business_day_close_time);
    return bDate >= startDateStr && bDate <= endDateStr;
  });

  // Fetch all order items for active orders
  const orderIds = filteredOrders.map((o: any) => o.id);
  let orderItems: any[] = [];
  
  if (orderIds.length > 0) {
    // Batch query to stay within request performance bounds
    const { data: items, error: itemsErr } = await client
      .from('order_items')
      .select('*')
      .in('order_id', orderIds);
    if (!itemsErr && items) {
      orderItems = items;
    }
  }

  const calculatedOrders: CalculatedOrderTax[] = [];
  const anomalies: TaxReportSummary['anomalies'] = [];

  // Group item lists by order
  const itemsByOrder: Record<string, any[]> = {};
  orderItems.forEach(item => {
    if (!itemsByOrder[item.order_id]) {
      itemsByOrder[item.order_id] = [];
    }
    itemsByOrder[item.order_id].push(item);
  });

  // Process and compile single order details
  filteredOrders.forEach((order: any) => {
    const bDate = getBusinessDate(order.created_at, config.timezone, config.business_day_close_time);
    const orderLines = itemsByOrder[order.id] || [];
    
    // Calculate details
    const orderCalc = calculateOrderTax(
      order,
      orderLines,
      config.tax_rate,
      config.tax_inclusive,
      config.service_charge,
      bDate
    );

    calculatedOrders.push(orderCalc);

    if (orderCalc.isSuspicious) {
      anomalies.push({
        orderId: orderCalc.orderId,
        receiptNumber: orderCalc.receiptNumber,
        reasons: orderCalc.suspiciousReasons,
        timestamp: orderCalc.created_at
      });
    }
  });

  // Aggregate totals
  let grossSalesSum = 0;
  let discountsSum = 0;
  let serviceChargesSum = 0;
  let taxableSalesSum = 0;
  let nonTaxableSalesSum = 0;
  let taxCollectedSum = 0;
  let refundsSum = 0;
  let taxRefundedSum = 0;
  let netTaxPayableSum = 0;
  let netSalesSum = 0;
  let totalCollectedSum = 0;

  const rateBreakdown: TaxReportSummary['rateBreakdown'] = {};

  calculatedOrders.forEach(o => {
    grossSalesSum += o.grossSales;
    discountsSum += o.discounts;
    serviceChargesSum += o.serviceCharges;
    taxableSalesSum += o.taxableSales;
    nonTaxableSalesSum += o.nonTaxableSales;
    taxCollectedSum += o.taxCollected;
    refundsSum += o.refunds;
    taxRefundedSum += o.taxRefunded;
    netTaxPayableSum += o.netTaxPayable;
    netSalesSum += o.netSales;
    totalCollectedSum += o.totalCollected;

    // Rate breakdown
    const rate = o.taxRate;
    if (!rateBreakdown[rate]) {
      rateBreakdown[rate] = {
        taxableAmount: 0,
        taxCollected: 0,
        taxRefunded: 0,
        netTax: 0
      };
    }
    rateBreakdown[rate].taxableAmount += o.taxableSales;
    rateBreakdown[rate].taxCollected += o.taxCollected;
    rateBreakdown[rate].taxRefunded += o.taxRefunded;
    rateBreakdown[rate].netTax += o.netTaxPayable;
  });

  // Decimal safe rounding of summaries
  grossSalesSum = roundToCents(grossSalesSum);
  discountsSum = roundToCents(discountsSum);
  serviceChargesSum = roundToCents(serviceChargesSum);
  taxableSalesSum = roundToCents(taxableSalesSum);
  nonTaxableSalesSum = roundToCents(nonTaxableSalesSum);
  taxCollectedSum = roundToCents(taxCollectedSum);
  refundsSum = roundToCents(refundsSum);
  taxRefundedSum = roundToCents(taxRefundedSum);
  netTaxPayableSum = roundToCents(netTaxPayableSum);
  netSalesSum = roundToCents(netSalesSum);
  totalCollectedSum = roundToCents(totalCollectedSum);

  // Round rate breakdown
  Object.keys(rateBreakdown).forEach((rKey: any) => {
    rateBreakdown[rKey] = {
      taxableAmount: roundToCents(rateBreakdown[rKey].taxableAmount),
      taxCollected: roundToCents(rateBreakdown[rKey].taxCollected),
      taxRefunded: roundToCents(rateBreakdown[rKey].taxRefunded),
      netTax: roundToCents(rateBreakdown[rKey].netTax)
    };
  });

  return {
    business_id: restaurantId,
    reportType,
    startDate: startDateStr,
    endDate: endDateStr,
    totalOrdersCount: calculatedOrders.length,
    grossSalesSum,
    discountsSum,
    serviceChargesSum,
    taxableSalesSum,
    nonTaxableSalesSum,
    taxCollectedSum,
    refundsSum,
    taxRefundedSum,
    netTaxPayableSum,
    netSalesSum,
    totalCollectedSum,
    rateBreakdown,
    anomalies,
    details: calculatedOrders
  };
}

/**
 * Converts tax summary report data into standard CSV content.
 */
export function convertReportToCSV(summary: TaxReportSummary): string {
  const headers = [
    'Receipt Number',
    'Order ID',
    'Business Date',
    'Gross Sales (RM)',
    'Discounts (RM)',
    'Service Charge (RM)',
    'Taxable Sales (RM)',
    'Non-Taxable Sales (RM)',
    'Tax Collected (RM)',
    'Refunds (RM)',
    'Tax Refunded (RM)',
    'Net Tax Payable (RM)',
    'Net Sales (RM)',
    'Total Collected (RM)',
    'Status'
  ];

  const rows = summary.details.map(d => [
    d.receiptNumber,
    d.orderId,
    d.businessDate,
    d.grossSales.toFixed(2),
    d.discounts.toFixed(2),
    d.serviceCharges.toFixed(2),
    d.taxableSales.toFixed(2),
    d.nonTaxableSales.toFixed(2),
    d.taxCollected.toFixed(2),
    d.refunds.toFixed(2),
    d.taxRefunded.toFixed(2),
    d.netTaxPayable.toFixed(2),
    d.netSales.toFixed(2),
    d.totalCollected.toFixed(2),
    d.status
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(val => `"${val}"`).join(','))
  ].join('\n');

  return csvContent;
}
