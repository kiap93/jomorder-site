import { Table, DiningSession, Restaurant } from '../../types';
import { Plus, Printer, Trash2, Settings2, Monitor, Globe, Edit2, Download, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';

interface TablesTabProps {
  tables: (Table & { dining_sessions?: DiningSession })[];
  restId: string | undefined;
  restaurant: Restaurant | null;
  printAllQRCodes: () => void;
  downloadQRCode: (tableId: string, tableName: string) => void;
  printQRCode: (tableId: string, tableName: string) => void;
  closeDiningSession: (session: DiningSession) => void;
  updateTableStatus: (id: string, status: 'available' | 'occupied') => void;
  deleteTable: (id: string) => void;
  addTable: () => void;
  openTableActionsId: string | null;
  setOpenTableActionsId: (id: string | null) => void;
  navigate: (path: string) => void;
  setActiveTab: (tab: any) => void;
  t: (key: string) => string;
}

export function TablesTab({
  tables,
  restId,
  restaurant,
  printAllQRCodes,
  downloadQRCode,
  printQRCode,
  closeDiningSession,
  updateTableStatus,
  deleteTable,
  addTable,
  openTableActionsId,
  setOpenTableActionsId,
  navigate,
  setActiveTab,
  t
}: TablesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
        <div>
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <span>{t('admin.tablesQR')}</span>
            <span className="text-[10px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full font-bold">Total: {tables.length}</span>
          </h2>
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-0.5">Generate physical table standees, print receipts/stickers, or download high-resolution QR vectors</p>
        </div>
        {tables.length > 0 && (
          <button
            onClick={printAllQRCodes}
            className="h-9 px-4 bg-zinc-900 text-white rounded-lg font-black text-[10px] uppercase tracking-wider hover:bg-black transition-all flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Printer size={13} />
            <span>Print All QR Codes</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tables.map(table => {
          const activeSession = table.dining_sessions;

          return (
            <div key={table.id} className={`p-4 rounded-xl shadow-sm border transition-all ${
              activeSession ? 'bg-orange-50/20 border-orange-100' : 'bg-white border-zinc-100'
            }`}>
              <div 
                id={`qr-container-${table.id}`}
                className="mb-4 bg-white p-3 rounded-2xl shadow-inner border border-zinc-50 flex flex-col items-center"
              >
                <QRCodeSVG 
                  value={`${window.location.origin}/restaurant/${restId}/table/${table.id}`} 
                  size={120}
                  level="H"
                  includeMargin={true}
                />
                
                <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-150/50 w-full justify-center">
                  <button
                    onClick={() => downloadQRCode(table.id, `Table ${table.name}`)}
                    title="Download high-quality PNG"
                    className="px-2 py-1 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all flex items-center justify-center gap-1 border border-zinc-200/50"
                  >
                    <Download size={10} />
                    <span>Download</span>
                  </button>
                  <button
                    onClick={() => printQRCode(table.id, `Table ${table.name}`)}
                    title="Print 80mm Table Card"
                    className="px-2 py-1 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all flex items-center justify-center gap-1 border border-zinc-200/50"
                  >
                    <Printer size={10} />
                    <span>Print</span>
                  </button>
                </div>
              </div>
              
              <div className="text-center mb-4">
                <h3 className="font-bold text-base text-zinc-900 leading-none mb-1.5">{t('kds.table').replace('{table}', table.name)}</h3>
                <div className="flex items-center justify-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeSession ? 'bg-orange-500 animate-pulse' : 'bg-zinc-200'}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${activeSession ? 'text-orange-600' : 'text-zinc-400'}`}>
                    {activeSession ? t('admin.activeSession') : t('admin.available')}
                  </span>
                </div>
              </div>
              
              <div className="flex flex-col gap-2 w-full">
                {activeSession ? (
                  <div className="space-y-2">
                    <div className="bg-white p-2.5 rounded-xl border border-orange-100 shadow-sm">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Started</span>
                        <span className="text-[9px] font-bold text-zinc-600">
                          {new Date(activeSession.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Token</span>
                        <span className="text-[9px] font-mono font-bold text-orange-600">
                          {activeSession.sessionToken ? `${activeSession.sessionToken.slice(0, 8)}...` : 'N/A'}
                        </span>
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => closeDiningSession(activeSession)}
                      className="w-full h-9 bg-zinc-900 text-white rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-black transition-all flex items-center justify-center gap-1.5"
                    >
                      <X size={12} />
                      {t('admin.closeSession')}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1 bg-zinc-100 p-0.5 rounded-lg mr-0.5">
                    <button
                      onClick={() => updateTableStatus(table.id, 'available')}
                      className={`py-1.5 rounded-md text-[9px] font-bold uppercase transition-all ${
                        table.status === 'available' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-400 font-medium'
                      }`}
                    >
                      {t('admin.available')}
                    </button>
                    <button
                      onClick={() => updateTableStatus(table.id, 'occupied')}
                      className={`py-1.5 rounded-md text-[9px] font-bold uppercase transition-all ${
                        table.status === 'occupied' ? 'bg-white text-orange-600 shadow-sm' : 'text-zinc-400 font-medium'
                      }`}
                    >
                      {t('admin.occupied')}
                    </button>
                  </div>
                )}

                <div className="flex gap-1.5">
                  <button 
                    onClick={() => deleteTable(table.id)} 
                    className="flex-1 h-9 rounded-lg bg-zinc-50 text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-all flex items-center justify-center gap-1.5 border border-zinc-150"
                  >
                    <Trash2 size={12} />
                    <span className="text-[9px] font-bold uppercase">{t('admin.delete')}</span>
                  </button>
                  <div className="relative flex-1">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenTableActionsId(openTableActionsId === table.id ? null : table.id);
                      }}
                      className="w-full h-9 rounded-xl bg-zinc-50 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 border border-zinc-150"
                    >
                      <Settings2 size={13} />
                      <span className="text-[10px] font-bold uppercase">{t('admin.actions')}</span>
                    </button>
                    <AnimatePresence>
                      {openTableActionsId === table.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute bottom-full right-0 z-[2] p-2 shadow-2xl bg-white rounded-2xl w-48 mb-2 border border-blue-50"
                        >
                          <div className="px-3 py-2 border-b border-gray-50 mb-1">
                            <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">{t('admin.management')}</span>
                          </div>
                          <button 
                            onClick={() => navigate(`/restaurant/${restId}/table/${table.id}`)} 
                            className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            <Monitor size={14} className="text-zinc-400" />
                            {t('admin.openTablePage')}
                          </button>
                          <button 
                            onClick={() => {
                              printQRCode(table.id, `Table ${table.name}`);
                              setOpenTableActionsId(null);
                            }} 
                            className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 text-zinc-700 hover:text-orange-600 transition-colors"
                          >
                            <Printer size={14} className="text-zinc-400" />
                            <span>Print QR Code</span>
                          </button>
                          <button 
                            onClick={() => {
                              downloadQRCode(table.id, `Table ${table.name}`);
                              setOpenTableActionsId(null);
                            }} 
                            className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 text-zinc-700 hover:text-orange-600 transition-colors"
                          >
                            <Download size={14} className="text-zinc-400" />
                            <span>Download PNG</span>
                          </button>
                          <button 
                            onClick={() => {
                              setActiveTab('localization');
                              setOpenTableActionsId(null);
                            }} 
                            className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            <Globe size={14} className="text-zinc-400" />
                            {t('admin.translateMenu')}
                          </button>
                          <button 
                            onClick={() => setOpenTableActionsId(null)}
                            className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            <Edit2 size={14} className="text-zinc-400" />
                            {t('admin.editDetails')}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <button 
          onClick={addTable}
          className="border-2 border-dashed border-gray-200 p-4 rounded-xl flex flex-col items-center justify-center gap-3 text-gray-400 font-bold hover:border-orange-200 hover:text-orange-500 transition-all hover:bg-orange-50/20"
        >
          <Plus size={24} />
          {t('admin.addTable')}
        </button>
      </div>
    </div>
  );
}
