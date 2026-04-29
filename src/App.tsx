/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useCallback } from "react";
import { 
  Printer, 
  Calendar, 
  Clock, 
  UtensilsCrossed, 
  User, 
  Plus, 
  Minus,
  RefreshCcw,
  CheckCircle2,
  Info,
  Bluetooth,
  ChevronRight,
  BluetoothSearching,
  BluetoothConnected,
  AlertTriangle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- Constants ---
// Generic BLE Printer UUIDs (Common for many ESC/POS BLE printers)
const BLE_PRINTER_SERVICE = "0000ff00-0000-1000-8000-00805f9b34fb";
const BLE_PRINTER_CHARACTERISTIC = "0000ff01-0000-1000-8000-00805f9b34fb";

export default function App() {
  // --- Bluetooth State ---
  const [btDevice, setBtDevice] = useState<any>(null);
  const [btCharacteristic, setBtCharacteristic] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);

  // --- Form State ---
  const [ingredient, setIngredient] = useState("");
  const [manipulationDate, setManipulationDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [validityDays, setValidityDays] = useState(3);
  const [collaborator, setCollaborator] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  // --- Quick Options ---
  const quickDays = [1, 3, 5, 7, 15, 30];

  // --- Calculations ---
  const expirationDate = useMemo(() => {
    try {
      const date = new Date(manipulationDate);
      date.setUTCDate(date.getUTCDate() + validityDays);
      return date.toISOString().split("T")[0];
    } catch {
      return "";
    }
  }, [manipulationDate, validityDays]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "--/--/----";
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  };

  // --- Bluetooth Connection ---
  const connectBluetooth = async () => {
    setIsConnecting(true);
    setBtError(null);
    
    try {
      if (!(navigator as any).bluetooth) {
        throw new Error("Web Bluetooth não suportado neste navegador. Use Chrome ou Edge.");
      }

      // Using acceptAllDevices: true allows the user to see all nearby devices
      // and pick the specific one they need, which is better for generic kitchen printers.
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          BLE_PRINTER_SERVICE, 
          "000018f0-0000-1000-8000-00805f9b34fb", 
          "0000ae01-0000-1000-8000-00805f9b34fb",
          "49535343-fe7d-41aa-8956-728370774220",
          "e7e11000-410a-48cb-9189-299f0ce583b0",
          "0000ff00-0000-1000-8000-00805f9b34fb"
        ]
      });

      setBtDevice(device);
      
      const server = await device.gatt?.connect();
      // Wait for GATT services to be discovered
      const services = await server?.getPrimaryServices();
      
      // Try to find a writable characteristic by iterating through all services/chars
      let writableChar = null;
      if (services) {
        for (const service of services) {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            // Check for write properties - standard for ESC/POS BLE
            if (char.properties.write || char.properties.writeWithoutResponse) {
              writableChar = char;
              break;
            }
          }
          if (writableChar) break;
        }
      }

      if (!writableChar) {
        throw new Error("Conectado, mas nenhuma característica de escrita (impressão) foi encontrada.");
      }

      setBtCharacteristic(writableChar);
      
      device.addEventListener('gattserverdisconnected', () => {
        setBtDevice(null);
        setBtCharacteristic(null);
      });

    } catch (err: any) {
      console.error(err);
      // Friendly error mapping
      if (err.name === 'NotFoundError') {
        setBtError("Busca cancelada ou nenhuma impressora selecionada.");
      } else {
        setBtError(err.message || "Erro ao conectar Bluetooth");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectBluetooth = () => {
    if (btDevice && btDevice.gatt.connected) {
      btDevice.gatt.disconnect();
    }
    setBtDevice(null);
    setBtCharacteristic(null);
  };

  // --- ESC/POS Command Generation ---
  const sendToBluetooth = async () => {
    if (!btCharacteristic) return;

    try {
      const encoder = new TextEncoder();
      
      // ESC/POS Commands
      const ESC = "\x1B";
      const GS = "\x1D";
      const INITIALIZE = ESC + "@";
      const CENTER = ESC + "a" + "\x01";
      const LEFT = ESC + "a" + "\x00";
      const BOLD_ON = ESC + "E" + "\x01";
      const BOLD_OFF = ESC + "E" + "\x00";
      const LARGE_TEXT = GS + "!" + "\x11"; // Double height and double width
      const NORMAL_TEXT = GS + "!" + "\x00";

      let commands = INITIALIZE;
      commands += CENTER;
      commands += BOLD_ON + (ingredient || "PRODUTO").toUpperCase() + "\n" + BOLD_OFF;
      commands += "--------------------------------\n";
      commands += LEFT;
      commands += "FAB: " + formatDate(manipulationDate) + "\n";
      commands += BOLD_ON + "VAL: " + formatDate(expirationDate) + "\n" + BOLD_OFF;
      if (collaborator) {
        commands += "RESP: " + collaborator.toUpperCase() + "\n";
      }
      commands += "--------------------------------\n";
      commands += CENTER;
      
      // Feed paper to allow for tearing (adding extra lines)
      // ESC d <n> feeds n lines.
      // Reduced to prevent skipping a full label (was \x0C + 4 newlines)
      commands += "\x1B" + "d" + "\x06"; 

      // Split into chunks if necessary (some printers have small buffers)
      const data = encoder.encode(commands);
      await btCharacteristic.writeValue(data);
      
      alert("Enviado para a impressora!");
    } catch (err: any) {
      alert("Erro ao enviar para impressora: " + err.message);
    }
  };

  const handlePrint = () => {
    if (!ingredient) {
      alert("Por favor, insira o nome do ingrediente antes de imprimir.");
      return;
    }
    
    if (btCharacteristic) {
      sendToBluetooth();
    } else {
      window.print();
    }
  };

  const resetForm = () => {
    setIngredient("");
    setManipulationDate(new Date().toISOString().split("T")[0]);
    setValidityDays(3);
    setCollaborator("");
  };

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#E0E0E0] font-sans selection:bg-orange-500 selection:text-white">
      {/* --- Main UI (Hidden during print) --- */}
      <div className="print:hidden pb-20">
        <header className="bg-[#1A1D23] border-b border-white/5 px-6 py-5 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md bg-opacity-80">
          <div className="flex items-center gap-3">
            <div className="bg-orange-600 p-2.5 rounded-xl text-white shadow-lg shadow-orange-900/20">
              <UtensilsCrossed size={24} />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-white leading-none">EtiquetaFácil</h1>
              <div className="flex items-center gap-2 mt-1">
                <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${btDevice ? 'text-orange-500' : 'text-blue-400'}`}>
                  {btDevice ? 'Gestão Bluetooth' : 'Modo Offline'}
                </p>
                {btDevice ? (
                  <span className="flex items-center gap-1 text-[9px] text-green-500 font-black uppercase tracking-widest bg-green-500/10 px-1.5 py-0.5 rounded">
                    <BluetoothConnected size={10} /> Online
                  </span>
                ) : (
                  <span className="text-[9px] text-blue-400 font-black uppercase tracking-widest bg-blue-500/10 px-1.5 py-0.5 rounded">
                    Preview Ativo
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!btDevice ? (
              <div className="flex flex-col items-end gap-1">
                <button 
                  onClick={connectBluetooth}
                  disabled={isConnecting}
                  className={`bg-blue-600 text-white px-4 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-blue-500 transition-all active:scale-95 shadow-xl shadow-blue-900/20 ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isConnecting ? <BluetoothSearching size={20} className="animate-spin" /> : <Bluetooth size={20} />}
                  <span className="hidden sm:inline">{isConnecting ? "Buscando..." : "Conectar Impressora"}</span>
                </button>
                {!(navigator as any).bluetooth && (
                  <span className="text-[10px] text-red-500 font-bold bg-red-500/10 px-2 py-0.5 rounded">Incompatível</span>
                )}
              </div>
            ) : (
              <button 
                onClick={disconnectBluetooth}
                className="bg-red-600/20 text-red-500 px-4 py-3 rounded-2xl font-bold border border-red-500/20 flex items-center gap-2 hover:bg-red-600 hover:text-white transition-all active:scale-95"
              >
                <BluetoothConnected size={20} />
                <span className="hidden sm:inline">Desconectar ({btDevice.name || 'Impressora'})</span>
              </button>
            )}
            <button 
              onClick={handlePrint}
              className={`px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-xl ${
                btCharacteristic 
                ? "bg-orange-600 text-white hover:bg-orange-500 shadow-orange-900/40" 
                : "bg-white text-black hover:bg-gray-200 shadow-black/40"
              }`}
            >
              {btCharacteristic ? <Printer size={20} /> : <Calendar size={20} />}
              <span className="hidden sm:inline">
                {btCharacteristic ? "Imprimir Agora" : "Gerar Etiqueta (PDF)"}
              </span>
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          
          {/* --- Form Section --- */}
          <section className="bg-[#1A1D23] rounded-[32px] p-6 md:p-10 border border-white/5 shadow-2xl space-y-10">
            {!btDevice && (
              <div className="p-4 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center gap-4">
                <div className="bg-blue-600 p-2 rounded-lg text-white">
                  <Info size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-blue-100">Modo Offline Ativo</p>
                  <p className="text-[10px] text-blue-400">Você pode preencher e visualizar. Conecte o Bluetooth para imprimir direto na impressora térmica.</p>
                </div>
              </div>
            )}

            {btError && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-600/10 border border-red-500/20 rounded-2xl space-y-3"
              >
                <div className="flex items-center gap-3 text-red-400 text-sm font-bold">
                  <AlertTriangle size={20} />
                  {btError}
                </div>
                {btError.includes("permissions policy") && (
                  <div className="bg-orange-500 text-black p-3 rounded-xl text-xs font-black">
                    ⚠️ ERRO DE PERMISSÃO: O navegador bloqueia Bluetooth dentro de janelas de pré-visualização. 
                    Clique no botão "Abrir em nova aba" (canto superior direito) para usar esta função.
                  </div>
                )}
              </motion.div>
            )}

            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <UtensilsCrossed className="text-orange-500" size={24} />
                  Novo Preparo
                </h2>
                <button 
                  onClick={resetForm}
                  className="text-gray-500 hover:text-orange-400 transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider"
                >
                  <RefreshCcw size={14} />
                  Limpar
                </button>
              </div>

              <div className="space-y-6">
                {/* Ingredient Input */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                    Ingrediente / Produto
                  </label>
                  <input
                    type="text"
                    value={ingredient}
                    onChange={(e) => setIngredient(e.target.value)}
                    placeholder="Ex: Molho Especial, Frango Cozido..."
                    className="w-full bg-[#0F1115] border border-white/10 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none transition-all text-xl font-bold text-white placeholder:text-gray-700"
                  />
                </div>

                {/* Date Selection */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                      Data de Manipulação
                    </label>
                    <input
                      type="date"
                      value={manipulationDate}
                      onChange={(e) => setManipulationDate(e.target.value)}
                      className="w-full bg-[#0F1115] border border-white/10 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none transition-all font-bold text-white uppercase text-sm cursor-pointer"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                      Validade (Dias)
                    </label>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setValidityDays(prev => Math.max(1, prev - 1))}
                        className="w-14 h-14 bg-[#0F1115] border border-white/10 rounded-2xl flex items-center justify-center hover:border-orange-500 transition-all text-white active:scale-90"
                      >
                        <Minus size={20} />
                      </button>
                      <div className="flex-1 h-14 bg-orange-600 rounded-2xl flex items-center justify-center font-black text-2xl text-white shadow-lg shadow-orange-900/40">
                        {validityDays}
                      </div>
                      <button 
                        onClick={() => setValidityDays(prev => prev + 1)}
                        className="w-14 h-14 bg-[#0F1115] border border-white/10 rounded-2xl flex items-center justify-center hover:border-orange-500 transition-all text-white active:scale-90"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Selection */}
                <div className="flex flex-wrap gap-2">
                  {quickDays.map(days => (
                    <button
                      key={days}
                      onClick={() => setValidityDays(days)}
                      className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all ${
                        validityDays === days 
                        ? "bg-white text-black border-white" 
                        : "bg-[#0F1115] text-gray-500 border-white/5 hover:border-white/20"
                      }`}
                    >
                      {days}D
                    </button>
                  ))}
                </div>

                {/* Collaborator */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                    Responsável
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                    <input
                      type="text"
                      value={collaborator}
                      onChange={(e) => setCollaborator(e.target.value)}
                      placeholder="Nome do funcionário"
                      className="w-full bg-[#0F1115] border border-white/10 rounded-2xl pl-12 pr-5 py-4 focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none transition-all font-bold text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-orange-600/10 border border-orange-500/20 rounded-[24px] flex items-center gap-6">
              <div className="flex-1 space-y-1">
                <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Resumo Automático</p>
                <div className="flex items-center gap-2 text-white">
                  <Calendar size={16} />
                  <span className="font-bold">{formatDate(manipulationDate)}</span>
                  <ChevronRight size={14} className="text-orange-500" />
                  <span className="font-black text-lg">{formatDate(expirationDate)}</span>
                </div>
              </div>
              <CheckCircle2 size={32} className="text-orange-500 opacity-50" />
            </div>
          </section>

          {/* --- Preview & Guide Section --- */}
          <section className="space-y-8 lg:sticky lg:top-32">
            <h2 className="text-xs font-black text-gray-600 uppercase tracking-[0.3em]">Pré-visualização</h2>
            
            <div className="relative group">
              <motion.div 
                layout
                className="bg-white text-black p-8 rounded-lg shadow-[0_40px_80px_rgba(0,0,0,0.5)] w-full max-w-[400px] mx-auto aspect-[1.4/1] flex flex-col justify-between border-4 border-black"
              >
                <div className="absolute top-0 left-0 w-full h-2 bg-black/5" />
                
                <div className="space-y-4">
                  <div className="border-b-4 border-black pb-3 text-center">
                    <h3 className="text-xl font-black uppercase break-words leading-none">
                      {ingredient || "SALADA TROPICAL"}
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-tight text-gray-400">Fabricado em</p>
                      <p className="text-lg font-black">{formatDate(manipulationDate)}</p>
                    </div>
                    <div className="space-y-1 text-right">
                      <p className="text-[9px] font-black uppercase tracking-tight text-gray-400">Vence em</p>
                      <p className="text-xl font-black text-red-600 leading-none">{formatDate(expirationDate)}</p>
                    </div>
                  </div>

                  {collaborator && (
                    <div className="pt-2 border-t border-black/5 flex justify-between items-center">
                      <p className="text-[9px] font-black uppercase tracking-tight text-gray-400">Responsável</p>
                      <p className="text-xs font-black italic">{collaborator}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>

            <div className="bg-[#1A1D23] border border-white/5 p-6 rounded-3xl space-y-4">
              <div className="flex items-start gap-4">
                <div className="bg-blue-500/20 p-2 rounded-lg text-blue-500">
                  <Info size={20} />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-white text-sm">Controle Bluetooth</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Clique em <b>Conectar</b> para abrir o seletor de dispositivos do sistema. Se sua impressora não aparecer, certifique-se que ela está ligada e não está conectada a outro aplicativo.
                  </p>
                </div>
              </div>
              
              <div className="p-4 bg-black/30 rounded-2xl border border-white/5 space-y-3">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Dicas de Conexão:</p>
                <div className="flex items-center gap-3 p-2 bg-orange-500/10 border border-orange-500/20 rounded-xl">
                  <div className="bg-orange-500 p-1.5 rounded-lg text-white">
                    <Bluetooth size={14} />
                  </div>
                  <p className="text-[10px] text-white font-bold">
                    Se não encontrar, clique no ícone "Abrir em nova aba" no topo do navegador. Em iframes o Bluetooth pode ser bloqueado.
                  </p>
                </div>
                <ul className="text-[10px] text-gray-600 space-y-2 list-disc pl-4 font-bold">
                  <li>Impressoras térmicas BLE geralmente se identificam como MTP-II, PT-210 ou similares.</li>
                  <li>Certifique-se que a localização (GPS) do celular está ligada (exigência do Android para Bluetooth).</li>
                </ul>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* --- Print-Only Content --- */}
      <div className="hidden print:block w-[50mm] mx-auto bg-white overflow-hidden">
        <div className="border-[2px] border-black p-2 flex flex-col justify-between h-[30mm] w-[50mm] box-border">
          <div className="border-b-[2px] border-black pb-1 text-center overflow-hidden">
            <h1 className="text-lg font-bold uppercase leading-none truncate">{ingredient || "PRODUTO"}</h1>
          </div>
          
          <div className="flex justify-between items-center border-b border-black pb-1">
            <div className="text-left">
              <p className="text-[7px] font-bold uppercase leading-none">Manip:</p>
              <p className="text-sm font-bold whitespace-nowrap">{formatDate(manipulationDate)}</p>
            </div>
            <div className="text-right">
              <p className="text-[7px] font-bold uppercase leading-none">Valid:</p>
              <p className="text-sm font-bold whitespace-nowrap">{formatDate(expirationDate)}</p>
            </div>
          </div>
          
          <div className="flex justify-between items-end">
            <div className="flex flex-col">
              {collaborator && (
                <p className="text-[8px] font-bold truncate max-w-[35mm]">Resp: {collaborator}</p>
              )}
            </div>
            <div className="text-right">
              <span className="text-[8px] font-bold">Val: {validityDays}D</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            size: 50mm 30mm;
            margin: 0;
          }
          body {
            background: white !important;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
          }
          .min-h-screen { min-height: auto !important; }
          * { -webkit-print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
