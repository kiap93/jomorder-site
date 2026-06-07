import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getApiUrl, getOrderDisplayNo } from '../lib/api';
import { useLanguageStore } from '../store/useLanguageStore';

import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  Download, 
  ChevronRight, 
  Home, 
  Receipt,
  Star
} from 'lucide-react';
import { Restaurant, Order } from '../types';

export function PaymentSuccess() {
  const { restId, tableId, orderId, sessionId } = useParams();
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!restId || restId === 'undefined' || restId === 'null') {
        setLoading(false);
        return;
      }
      try {
        const orderRes = await fetch(getApiUrl(`/api/public/orders/${orderId}?sessionId=${sessionId}`));
        if (!orderRes.ok) throw new Error("Order not found");
        const orderData = await orderRes.json();

        if (orderData?.session_id) {
          const [restRes, ordersRes] = await Promise.all([
            fetch(getApiUrl(`/api/public/restaurants/${restId}`)).then(r => r.json()),
            fetch(getApiUrl(`/api/public/dining-sessions/${orderData.session_id}/orders`)).then(r => r.json())
          ]);
          
          setRestaurant(restRes as any);
          setOrders((ordersRes || []).map((o: any) => ({
            ...o,
            totalPrice: parseFloat(o.total_price),
            createdAt: o.created_at
          })) as any);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [restId, orderId]);

  if (loading) return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
    </div>
  );

  const totalPaid = orders.reduce((sum, o) => sum + (o.paid_at ? (o.totalPrice || 0) : 0), 0);
  const resolvedSessionId = sessionId && sessionId !== 'undefined' ? sessionId : (orders[0] as any)?.session_id;
  const backToMenuUrl = resolvedSessionId 
    ? `/restaurant/${restId}/table/${tableId}/session/${resolvedSessionId}` 
    : `/restaurant/${restId}/table/${tableId}`;

  const showVoided = restaurant?.show_voided_on_receipt !== false;
  const allPaidOrders = orders.filter(o => o.paid_at);

  // Accumulate all items across paid orders of this session
  const receiptItems = allPaidOrders.flatMap(o => o.items || []).filter(item => {
    if (item.voided && !showVoided) return false;
    return true;
  });

  const handlePrintReceipt = () => {
    let itemsSubtotal = 0;
    let totalDiscounts = 0;

    const itemsRowsHtml = allPaidOrders.flatMap(order => (order.items || [])).map((item, idx) => {
      const isVoided = item.voided;
      if (isVoided && !showVoided) return '';

      const originalUnitPrice = item.originalUnitPrice !== undefined ? item.originalUnitPrice : item.price;
      let finalUnitPrice = originalUnitPrice;
      let discountAmount = 0;
      let discountLabel = '';

      if (item.discount) {
        if (item.discount.type === 'percentage') {
          discountAmount = originalUnitPrice * (item.discount.value / 100);
          finalUnitPrice = originalUnitPrice - discountAmount;
          discountLabel = `Discount ${item.discount.value}%`;
        } else if (item.discount.type === 'fixed') {
          discountAmount = item.discount.value;
          finalUnitPrice = Math.max(0, originalUnitPrice - discountAmount);
          discountLabel = `Discount RM ${item.discount.value.toFixed(2)}`;
        } else if (item.discount.type === 'override') {
          finalUnitPrice = item.discount.value;
          discountAmount = Math.max(0, originalUnitPrice - finalUnitPrice);
          discountLabel = `Promo Price Override`;
        }
      }

      if (!isVoided) {
        itemsSubtotal += originalUnitPrice * item.quantity;
        totalDiscounts += discountAmount * item.quantity;
      }

      const totalDisplay = isVoided ? '*** VOIDED ***' : `RM ${(finalUnitPrice * item.quantity).toFixed(2)}`;

      return `
        <div style="margin-bottom: 12px; font-family: monospace; font-size: 14px;">
          <div style="display: flex; justify-content: space-between; font-weight: bold;">
            <span style="${isVoided ? 'text-decoration: line-through; color: #777;' : ''}">${item.quantity}x ${item.name}</span>
            <span style="${isVoided ? 'text-decoration: line-through; color: #777;' : ''}">RM ${(originalUnitPrice * item.quantity).toFixed(2)}</span>
          </div>
          ${discountLabel && !isVoided ? `
            <div style="display: flex; justify-content: space-between; color: #777; font-size: 12px; padding-left: 15px;">
              <span>${discountLabel}</span>
              <span>-RM ${(discountAmount * item.quantity).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; padding-left: 15px; border-top: 1px dotted #ccc; margin-top: 2px;">
              <span>Final</span>
              <span>${totalDisplay}</span>
            </div>
          ` : ''}
          ${isVoided ? `
            <div style="color: #d32f2f; font-weight: bold; font-size: 11px; padding-left: 15px; margin-top: 3px; text-transform: uppercase;">
              *** VOIDED ***
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    const scRate = restaurant?.serviceCharge !== undefined ? restaurant.serviceCharge / 100 : 0.06;
    const sstRate = restaurant?.sst !== undefined ? restaurant.sst / 100 : 0.10;

    const netSubtotal = Math.max(0, itemsSubtotal - totalDiscounts);
    const serviceChargeTotal = netSubtotal * scRate;
    const sstTotal = (netSubtotal + serviceChargeTotal) * sstRate;
    const grandTotal = netSubtotal + serviceChargeTotal + sstTotal;

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Receipt - Session #${resolvedSessionId || 'N/A'}</title>
        <style>
          @media print {
            body { margin: 0; padding: 0; }
            @page { margin: 0; }
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            margin: 15px;
            color: #000;
            background: #fff;
            width: 80mm;
            max-width: 80mm;
            line-height: 1.4;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
          }
          .restaurant-name {
            font-size: 18px;
            font-weight: 950;
            text-transform: uppercase;
            margin-bottom: 5px;
            letter-spacing: 1px;
          }
          .title {
            font-size: 11px;
            font-weight: bold;
            color: #444;
            letter-spacing: 2px;
            margin-bottom: 15px;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 12px 0;
          }
          .double-divider {
            border-top: 3px double #005;
            margin: 12px 0;
          }
          .meta-row {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-bottom: 4px;
            font-weight: bold;
          }
          .totals-row {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            margin-bottom: 6px;
            font-family: monospace;
          }
          .grand-total {
            display: flex;
            justify-content: space-between;
            font-size: 17px;
            font-weight: bold;
            font-family: monospace;
          }
          .footer {
            text-align: center;
            margin-top: 35px;
            font-size: 10px;
            font-weight: bold;
            border-top: 1px dashed #000;
            padding-top: 15px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="restaurant-name">${restaurant?.name || 'SMART RESTAURANT'}</div>
          <div class="title">OFFICIAL RECEIPT</div>
        </div>

        <div class="meta-row">
          <span>DATE:</span>
          <span>${new Date().toLocaleDateString()}</span>
        </div>
        <div class="meta-row">
          <span>TIME:</span>
          <span>${new Date().toLocaleTimeString()}</span>
        </div>
        <div class="meta-row">
          <span>TABLE ID:</span>
          <span>${tableId || 'POS'}</span>
        </div>
        <div class="meta-row">
          <span>TX REF:</span>
          <span>${orderId?.slice(0, 8).toUpperCase() || 'N/A'}</span>
        </div>

        <div class="double-divider"></div>

        <div style="font-size: 11px; font-weight: bold; margin-bottom: 10px; letter-spacing: 1px;">
          ITEMIZED SUMMARIES:
        </div>

        <div>
          ${itemsRowsHtml}
        </div>

        <div class="divider"></div>

        <div class="totals-row">
          <span>SUBTOTAL:</span>
          <span>RM ${itemsSubtotal.toFixed(2)}</span>
        </div>
        ${totalDiscounts > 0 ? `
          <div class="totals-row" style="color: #444; font-weight: bold;">
            <span>TOTAL DISCOUNTS:</span>
            <span>-RM ${totalDiscounts.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="totals-row">
          <span>SERVICE CHARGE (${(scRate * 100).toFixed(0)}%):</span>
          <span>RM ${serviceChargeTotal.toFixed(2)}</span>
        </div>
        <div class="totals-row">
          <span>GOVT SST (${(sstRate * 100).toFixed(0)}%):</span>
          <span>RM ${sstTotal.toFixed(2)}</span>
        </div>

        <div class="double-divider"></div>

        <div class="grand-total">
          <span>GRAND TOTAL:</span>
          <span>RM ${grandTotal.toFixed(2)}</span>
        </div>

        <div class="footer">
          THANK YOU FOR DINING WITH US!<br/>
          JOMORDER MOBILE CHECKOUTS<br/>
          POWERED BY JOMORDER (SaaS)
        </div>
      </body>
      </html>
    `;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      
      document.body.appendChild(iframe);
      
      const doc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!doc) throw new Error('Could not access print window context');
      
      doc.open();
      doc.write(receiptHtml);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.warn('[Receipt] Hidden printer layout call failed:', e);
        } finally {
          setTimeout(() => {
            document.body.removeChild(iframe);
          }, 60000);
        }
      }, 500);
    } catch (e) {
      console.error('[Receipt] Print execution failed:', e);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-emerald-500/30">
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/20 blur-[120px] -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/10 blur-[120px] translate-y-1/2 -translate-x-1/2" />
      </div>

      <main className="relative z-10 px-6 py-12 max-w-lg mx-auto flex flex-col items-center text-center">
        {/* Success Animation */}
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mb-8 relative"
        >
          <CheckCircle2 size={48} strokeWidth={2.5} />
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1.2 }}
            transition={{ delay: 0.5, duration: 1, repeat: Infinity, repeatType: "reverse" }}
            className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl"
          />
        </motion.div>

        <motion.div
           initial={{ y: 20, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           transition={{ delay: 0.2 }}
        >
          <h1 className="text-3xl font-black mb-2 tracking-tighter uppercase italic">Payment Received</h1>
          <p className="text-zinc-500 text-sm font-medium mb-8">Thank you for dining at <span className="text-zinc-300">{restaurant?.name}</span></p>
        </motion.div>

        {/* Amount Card */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="w-full bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-[3rem] p-10 mb-8 overflow-hidden relative"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          <div className="flex flex-col items-center gap-1 mb-10">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">{t('common.totalSettlement')}</p>
            <h2 className="text-5xl font-black tabular-nums tracking-tight">
              RM <span className="text-white">{totalPaid.toFixed(2)}</span>
            </h2>
          </div>

          <div className="space-y-4 text-left">
            <div className="flex justify-between items-center text-[11px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-3">
               <span>Item Summary</span>
               <span>Amount</span>
            </div>
            <div className="max-h-56 overflow-y-auto pr-2 space-y-1.5 custom-scrollbar">
              {receiptItems.length > 0 ? (
                receiptItems.map((item: any, idx: number) => {
                  const isVoided = item.voided;
                  const originalUnitPrice = item.originalUnitPrice !== undefined ? item.originalUnitPrice : item.price;
                  let finalUnitPrice = originalUnitPrice;
                  let discountAmount = 0;
                  let discountLabel = '';

                  if (item.discount) {
                    if (item.discount.type === 'percentage') {
                      discountAmount = originalUnitPrice * (item.discount.value / 100);
                      finalUnitPrice = originalUnitPrice - discountAmount;
                      discountLabel = `Discount ${item.discount.value}%`;
                    } else if (item.discount.type === 'fixed') {
                      discountAmount = item.discount.value;
                      finalUnitPrice = Math.max(0, originalUnitPrice - discountAmount);
                      discountLabel = `Discount RM ${item.discount.value.toFixed(2)}`;
                    } else if (item.discount.type === 'override') {
                      finalUnitPrice = item.discount.value;
                      discountAmount = Math.max(0, originalUnitPrice - finalUnitPrice);
                      discountLabel = `Price Override`;
                    }
                  }

                  const originalTotal = originalUnitPrice * item.quantity;
                  const finalTotal = finalUnitPrice * item.quantity;

                  return (
                    <div key={item.id || idx} className="space-y-0.5 py-2 border-b border-zinc-800/40 last:border-0">
                      <div className="flex justify-between items-start text-[13px]">
                        <div className="flex flex-col">
                          <span className={`${isVoided ? 'line-through text-zinc-500 font-medium' : 'text-zinc-200 font-bold'}`}>
                            {item.quantity}x {item.name}
                          </span>
                          {isVoided && (
                            <span className="text-red-500 text-[9px] uppercase font-black tracking-wider ring-1 ring-red-500/30 px-1 py-0.5 rounded w-max mt-1">
                              *** VOIDED ***
                            </span>
                          )}
                          {!isVoided && discountLabel && (
                            <span className="text-amber-500 text-[10px] uppercase font-bold tracking-wider mt-0.5">
                              {discountLabel} (-RM ${(discountAmount * item.quantity).toFixed(2)})
                            </span>
                          )}
                        </div>
                        <div className="text-right flex flex-col font-mono text-[12px]">
                          {isVoided ? (
                            <span className="text-zinc-500 font-bold line-through">RM {originalTotal.toFixed(2)}</span>
                          ) : (
                            <>
                              {discountLabel && (
                                <span className="line-through text-[10px] text-zinc-500">
                                  RM {originalTotal.toFixed(2)}
                                </span>
                              )}
                              <span className="text-zinc-350 font-bold">
                                RM {finalTotal.toFixed(2)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                // Fallback to Order summary if items structure is vacant
                orders.filter(o => o.paid_at).map(o => (
                  <div key={o.id} className="flex justify-between items-center text-[12px]">
                     <div className="flex flex-col">
                        <span className="text-zinc-300 font-bold tracking-tight">Order #{getOrderDisplayNo(o.id, o.createdAt)}</span>
                        <span className="text-zinc-600 text-[10px] uppercase font-black tracking-tighter">
                           {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                     </div>
                     <span className="text-zinc-400 font-black">RM {(o.totalPrice || 0).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="pt-4 mt-2 border-t border-dashed border-zinc-800 flex justify-between items-center">
               <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Transaction Verified</span>
               </div>
               <div className="flex items-center gap-1 text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded text-[10px] font-bold">
                  <Receipt size={10} />
                  <span>REF: {orderId?.slice(0, 8).toUpperCase() || 'N/A'}</span>
               </div>
            </div>
          </div>
        </motion.div>

        {/* Action Grid */}
        <div className="grid grid-cols-2 gap-4 w-full mb-12">
           <button 
             onClick={handlePrintReceipt}
             className="h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-all group"
           >
              <Download size={18} className="text-zinc-400 group-hover:text-emerald-500 transition-colors" />
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Get Receipt</span>
           </button>
           <Link 
              to={backToMenuUrl}
              className="h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-all group"
           >
              <Home size={18} className="text-zinc-400 group-hover:text-orange-500 transition-colors" />
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Back to Menu</span>
           </Link>
        </div>

        {/* Feedback Section */}
        <div className="w-full bg-orange-600/5 border border-orange-600/20 rounded-3xl p-6 flex flex-col items-center">
           <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500 mb-4 text-center">How was your experience?</p>
           <div className="flex gap-4">
              {[1, 2, 3, 4, 5].map(i => (
                <button key={i} className="text-orange-900 hover:text-orange-500 transition-colors">
                   <Star size={24} fill={i <= 4 ? "currentColor" : "none"} />
                </button>
              ))}
           </div>
        </div>

        <div className="mt-12 text-center text-[10px] font-bold text-zinc-600 tracking-widest uppercase flex items-center justify-center gap-4">
           <span>Securely Processed</span>
           <div className="w-1.5 h-1.5 bg-zinc-800 rounded-full" />
           <span>256-BIT AES</span>
        </div>
      </main>
    </div>
  );
}
