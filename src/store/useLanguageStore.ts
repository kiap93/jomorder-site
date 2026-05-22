import { create } from 'zustand';

export type LanguageCode = 'en' | 'zh' | 'ms';

export const translations = {
  en: {
    // General / Common
    "common.back": "Back",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.loading": "Loading...",
    "common.error": "An error occurred",
    "common.success": "Success",
    "common.warning": "Warning",
    "common.search": "Search",
    "common.status": "Status",
    "common.total": "Total",
    "common.subtotal": "Subtotal",
    "common.quantity": "Qty",
    "common.action": "Action",
    "common.inactive": "Inactive",
    "common.active": "Active",
    "common.add": "Add",
    "common.remove": "Remove",
    "common.choose": "Choose",
    "common.required": "Required",
    "common.optional": "Optional",

    // Navbar / Profile
    "navbar.viewProfile": "View Profile Settings",
    "navbar.manageOutlets": "Manage Outlets",
    "navbar.signOut": "Sign Out",
    "navbar.signedInAs": "Signed In As",
    "navbar.switchBrand": "Switch Brand",
    "navbar.activeIdentity": "Active Identity Profile",
    "navbar.dismiss": "Dismiss Settings",
    "navbar.accountEmail": "Account Email",
    "navbar.userId": "User Identity Reference (UID)",
    "navbar.tenantToken": "Active Tenant Authorization token",

    // Workspace & Session Select
    "workspace.title": "Choose Restaurant Outlet",
    "workspace.subtitle": "Select a workspace below to enter operational session stream",
    "workspace.connected": "Currently connected session stream",
    "workspace.visited": "Visited",
    "workspace.suspended": "Suspended",
    "workspace.enter": "Enter Workspace",
    "workspace.searchPlaceholder": "Search by outlet or organization name...",
    "workspace.noAccess": "You do not have access to any workspaces. Please contact the administrator.",
    "workspace.brand": "Brand",
    "workspace.createOrg": "Create New Organization & Brand",

    // Customer Menu & Customer Orders
    "menu.title": "Menu Selection",
    "menu.search": "Search dishes in this menu...",
    "menu.addToBasket": "Add to Basket",
    "menu.incomplete": "Incomplete custom selection",
    "menu.viewBasket": "View Basket",
    "menu.totalItems": "items in basket",
    "menu.emptyBasket": "Your basket is empty",
    "menu.basketTitle": "Your Selection Tray",
    "menu.placeOrder": "Send Order to Kitchen",
    "menu.dineIn": "Dine In (Table {table})",
    "menu.takeaway": "Takeaway / Self-Pickup",
    "menu.specialInstructions": "Special Instructions (e.g. no onions, less spicy)",
    "menu.clearInstructions": "Clear special instructions",
    "menu.price": "Price",
    "menu.options": "Configure Selection",
    "menu.tableNo": "Table No",
    "menu.select": "Select",
    "menu.orderedSuccessful": "Order Placed Successfully",
    "menu.orderSentSuccess": "Your order has been sent to the kitchen and is being prepared.",
    "menu.trackStatus": "Track Order status",
    "menu.orderSummary": "Order Summary",
    "menu.orderStatus": "Order Real-Time Stream",

    // Order/Dining statuses
    "status.pending": "Received",
    "status.confirmed": "Confirmed",
    "status.cooking": "Cooking",
    "status.ready": "Ready to Serve",
    "status.served": "Served",
    "status.completed": "Paid & Done",
    "status.cancelled": "Cancelled",

    // Payment & checkout
    "payment.title": "Checkout & Payment Request",
    "payment.selectMethod": "Select your payment method",
    "payment.cash": "Pay with Cash at Cashier Desk",
    "payment.online": "Debit/Credit / E-Wallet Stream",
    "payment.payNow": "Authenticate & Pay Now",
    "payment.success": "Payment Completed",
    "payment.thanks": "Thank you for dining with us! Your digital receipt has been registered.",
    "payment.subtotal": "Subtotal Selection",
    "payment.sst": "Government SST (10%)",
    "payment.serviceCharge": "Service Charge (6%)",
    "payment.grandTotal": "Grand Total Amount Due",
    "payment.table": "Dining Table",
    "payment.session": "Session ID",

    // POS Dashboard & Admin Panel
    "pos.tables": "Layout Tables",
    "pos.orders": "Order Stream",
    "pos.posTitle": "Enterprise System Dashboard",
    "pos.sales": "Total Registered Sales (MYR)",
    "pos.activeTables": "Occupied Table Spots",
    "pos.pendingOrders": "Active Backlog Orders",
    "pos.cashCalcTitle": "Frictionless Cash Counter Calculator",
    "pos.cashReceived": "Cash Received",
    "pos.changeDue": "Cash Change Due",
    "pos.actionRequired": "Actions Required",
    "pos.markPaid": "Mark as Fully Paid",
  },
  zh: {
    // General / Common
    "common.back": "返回",
    "common.cancel": "取消",
    "common.confirm": "确认",
    "common.save": "保存",
    "common.delete": "删除",
    "common.edit": "编辑",
    "common.loading": "加载中...",
    "common.error": "发生错误",
    "common.success": "成功",
    "common.warning": "警告",
    "common.search": "搜索",
    "common.status": "状态",
    "common.total": "总计",
    "common.subtotal": "小计",
    "common.quantity": "数量",
    "common.action": "操作",
    "common.inactive": "未启用",
    "common.active": "已启用",
    "common.add": "添加",
    "common.remove": "移除",
    "common.choose": "选择",
    "common.required": "必选",
    "common.optional": "可选",

    // Navbar / Profile
    "navbar.viewProfile": "查看个人设置",
    "navbar.manageOutlets": "管理分店",
    "navbar.signOut": "退出登录",
    "navbar.signedInAs": "登录身份",
    "navbar.switchBrand": "切换品牌",
    "navbar.activeIdentity": "活动身份标识",
    "navbar.dismiss": "关闭窗口",
    "navbar.accountEmail": "账号邮箱",
    "navbar.userId": "用户标识符 (UID)",
    "navbar.tenantToken": "活动租户令牌",

    // Workspace & Session Select
    "workspace.title": "选择餐饮分店",
    "workspace.subtitle": "请选择下方的工作空间以进入运行控制会话",
    "workspace.connected": "当前连接的活动分店",
    "workspace.visited": "最近访问",
    "workspace.suspended": "账号停用",
    "workspace.enter": "进入工作区",
    "workspace.searchPlaceholder": "搜索分店或品牌组织名称...",
    "workspace.noAccess": "您目前没有任何分店的访问权限，请联系系统管理员。",
    "workspace.brand": "品牌组织",
    "workspace.createOrg": "创建新的品牌与组织",

    // Customer Menu & Customer Orders
    "menu.title": "精选菜单",
    "menu.search": "在菜单中搜索餐品...",
    "menu.addToBasket": "加入购物车",
    "menu.incomplete": "未选完必选项",
    "menu.viewBasket": "查看购物车",
    "menu.totalItems": "件商品在购物车中",
    "menu.emptyBasket": "购物车里空空如也",
    "menu.basketTitle": "您的选购篮",
    "menu.placeOrder": "提交订单至厨房",
    "menu.dineIn": "堂食点餐 (桌号 {table})",
    "menu.takeaway": "外带打包 / 自提",
    "menu.specialInstructions": "特殊备注 (如: 不要葱, 少辣)",
    "menu.clearInstructions": "清空特殊备注",
    "menu.price": "售价",
    "menu.options": "定制选项",
    "menu.tableNo": "桌号",
    "menu.select": "选择",
    "menu.orderedSuccessful": "订单提交成功！",
    "menu.orderSentSuccess": "您的订单已送往厨房，正火速为您准备。",
    "menu.trackStatus": "追踪备餐状态",
    "menu.orderSummary": "订单餐单详情",
    "menu.orderStatus": "订单实时动态",

    // Order/Dining statuses
    "status.pending": "已接收",
    "status.confirmed": "已确认",
    "status.cooking": "烹饪中",
    "status.ready": "已出餐 (请取餐)",
    "status.served": "已上菜",
    "status.completed": "已结账完成",
    "status.cancelled": "已取消",

    // Payment & checkout
    "payment.title": "结账与在线支付",
    "payment.selectMethod": "选择付款方式",
    "payment.cash": "前往收银处支付现金",
    "payment.online": "借记卡/信用卡 / 数字钱包",
    "payment.payNow": "立即进行结账付款",
    "payment.success": "付款已成功结清",
    "payment.thanks": "非常感谢您的光临！您的数字账单已成功结账。",
    "payment.subtotal": "餐品小计金额",
    "payment.sst": "政府销售税 SST (10%)",
    "payment.serviceCharge": "服务费 (6%)",
    "payment.grandTotal": "应付账单总额",
    "payment.table": "用餐桌位",
    "payment.session": "用餐流水 ID",

    // POS Dashboard & Admin Panel
    "pos.tables": "餐厅桌位布局",
    "pos.orders": "实时订单动态",
    "pos.posTitle": "餐饮门店智能管理面板",
    "pos.sales": "今日累计营业额 (MYR)",
    "pos.activeTables": "已占用用餐桌位",
    "pos.pendingOrders": "待处理队列订单",
    "pos.cashCalcTitle": "快捷现金结账计算器",
    "pos.cashReceived": "实收现金",
    "pos.changeDue": "应找零零钱",
    "pos.actionRequired": "需要处理的操作",
    "pos.markPaid": "标记为已支付结账",
  },
  ms: {
    // General / Common
    "common.back": "Kembali",
    "common.cancel": "Batal",
    "common.confirm": "Sahkan",
    "common.save": "Simpan",
    "common.delete": "Padam",
    "common.edit": "Edit",
    "common.loading": "Memuatkan...",
    "common.error": "Ralat berlaku",
    "common.success": "Berjaya",
    "common.warning": "Amaran",
    "common.search": "Cari",
    "common.status": "Status",
    "common.total": "Jumlah",
    "common.subtotal": "Subjumlah",
    "common.quantity": "Bil",
    "common.action": "Tindakan",
    "common.inactive": "Tidak Aktif",
    "common.active": "Aktif",
    "common.add": "Tambah",
    "common.remove": "Buang",
    "common.choose": "Pilih",
    "common.required": "Wajib",
    "common.optional": "Pilihan",

    // Navbar / Profile
    "navbar.viewProfile": "Lihat Tetapan Profil",
    "navbar.manageOutlets": "Urus Cawangan",
    "navbar.signOut": "Log Keluar",
    "navbar.signedInAs": "Log Masuk Sebagai",
    "navbar.switchBrand": "Tukar Jenama",
    "navbar.activeIdentity": "Profil Identiti Aktif",
    "navbar.dismiss": "Tutup Tetapan",
    "navbar.accountEmail": "E-mel Akaun",
    "navbar.userId": "Rujukan Identiti Pengguna (UID)",
    "navbar.tenantToken": "Token Kebenaran Tenant Aktif",

    // Workspace & Session Select
    "workspace.title": "Pilih Cawangan Restoran",
    "workspace.subtitle": "Sila pilih ruang kerja di bawah untuk memasuki aliran sistem operasi",
    "workspace.connected": "Cawangan Sedang Bersambung",
    "workspace.visited": "Terakhir Dikunjungi",
    "workspace.suspended": "Akaun Digantung",
    "workspace.enter": "Masuk Ruang Kerja",
    "workspace.searchPlaceholder": "Cari cawangan atau nama organisasi...",
    "workspace.noAccess": "Anda tidak mempunyai akses ke mana-mana ruang kerja. Sila hubungi pentadbir.",
    "workspace.brand": "Kumpulan Jenama",
    "workspace.createOrg": "Daftar Organisasi & Jenama Baru",

    // Customer Menu & Customer Orders
    "menu.title": "Pilihan Menu",
    "menu.search": "Cari hidangan dalam menu ini...",
    "menu.addToBasket": "Tambah ke Troli",
    "menu.incomplete": "Pilihan wajib belum lengkap",
    "menu.viewBasket": "Lihat Troli",
    "menu.totalItems": "item di dalam troli",
    "menu.emptyBasket": "Troli anda kosong",
    "menu.basketTitle": "Talam Pilihan Anda",
    "menu.placeOrder": "Hantar Pesanan ke Dapur",
    "menu.dineIn": "Makan Di Sini (Meja {table})",
    "menu.takeaway": "Bungkus / Ambil Sendiri",
    "menu.specialInstructions": "Arahan Khas (cth. tiada bawang, kurang pedas)",
    "menu.clearInstructions": "Padam arahan khas",
    "menu.price": "Harga",
    "menu.options": "Ubah Suai Pilihan",
    "menu.tableNo": "Meja No",
    "menu.select": "Pilih",
    "menu.orderedSuccessful": "Pesanan Berjaya Dihantar!",
    "menu.orderSentSuccess": "Pesanan anda telah berjaya dihantar ke dapur dan sedang disediakan.",
    "menu.trackStatus": "Jejak status penyediaan",
    "menu.orderSummary": "Ringkasan Pesanan",
    "menu.orderStatus": "Aliran Status Pesanan Real-Time",

    // Order/Dining statuses
    "status.pending": "Diterima",
    "status.confirmed": "Disahkan",
    "status.cooking": "Sedang Dimasak",
    "status.ready": "Sedia Dihidang",
    "status.served": "Telah Dihidang",
    "status.completed": "Selesai & Dibayar",
    "status.cancelled": "Dibatalkan",

    // Payment & checkout
    "payment.title": "Pembayaran & Bil",
    "payment.selectMethod": "Pilih kaedah pembayaran",
    "payment.cash": "Bayar Secara Tunai di Kaunter Juruwang",
    "payment.online": "Kad Debit/Kredit / Aliran E-Wallet",
    "payment.payNow": "Sahkan & Bayar Sekarang",
    "payment.success": "Pembayaran Selesai",
    "payment.thanks": "Terima kasih kerana menjamu selera bersama kami! Resit digital anda telah direkodkan.",
    "payment.subtotal": "Subjumlah Bil Terpilih",
    "payment.sst": "Cukai Jualan Kerajaan SST (10%)",
    "payment.serviceCharge": "Caj Perkhidmatan (6%)",
    "payment.grandTotal": "Jumlah Besar Perlu Dibayar",
    "payment.table": "Meja Makan",
    "payment.session": "ID Sesi Makan",

    // POS Dashboard & Admin Panel
    "pos.tables": "Susun Atur Meja",
    "pos.orders": "Aliran Pesanan Semasa",
    "pos.posTitle": "Papan Pemuka Pintar Outlet",
    "pos.sales": "Jumlah Jualan Hari Ini (MYR)",
    "pos.activeTables": "Meja Sedang Digunakan",
    "pos.pendingOrders": "Pesanan Dalam Giliran aktif",
    "pos.cashCalcTitle": "Kalkulator Tunai Kaunter Juruwang",
    "pos.cashReceived": "Wang Tunai Diterima",
    "pos.changeDue": "Baki Wang Perlu Dipulangkan",
    "pos.actionRequired": "Tindakan Diperlukan",
    "pos.markPaid": "Tandakan Telah Bayar",
  }
} as const;

interface LanguageState {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
}

const getBrowserLanguage = (): LanguageCode => {
  const local = localStorage.getItem('jomorder_locale');
  if (local === 'en' || local === 'zh' || local === 'ms') {
    return local;
  }
  const navLang = navigator.language?.toLowerCase() || '';
  if (navLang.includes('zh') || navLang.includes('cn')) return 'zh';
  if (navLang.includes('ms') || navLang.includes('my')) return 'ms';
  return 'en';
};

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: getBrowserLanguage(),
  setLanguage: (lang: LanguageCode) => {
    localStorage.setItem('jomorder_locale', lang);
    set({ language: lang });
  },
  t: (key: string, variables?: Record<string, string | number>) => {
    const currentLang = get().language;
    const dictionary = translations[currentLang] || translations.en;
    let text = (dictionary as any)[key] || (translations.en as any)[key] || key;
    
    if (variables) {
      Object.entries(variables).forEach(([vKey, vVal]) => {
        text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
      });
    }
    
    return text;
  }
}));
