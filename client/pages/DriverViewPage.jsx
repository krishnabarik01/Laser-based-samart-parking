import React, { useState, useEffect } from 'react';
import { 
  Car, 
  Bike, 
  Search, 
  Compass, 
  Navigation, 
  Sparkles, 
  CheckCircle2, 
  MapPin, 
  Clock, 
  ArrowRight 
} from 'lucide-react';
import { api } from '../services/api';
import { wsClient } from '../services/ws';

export default function DriverViewPage() {
  const [lotSummary, setLotSummary] = useState({
    carsAvailable: 34,
    bikesAvailable: 44,
  });

  const [selectedVehicleType, setSelectedVehicleType] = useState('car'); // 'car' | 'bike'
  const [nearestSlot, setNearestSlot] = useState(null);
  const [searchPlate, setSearchPlate] = useState('');
  const [foundVehicle, setFoundVehicle] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchDriverState = () => {
    api.getLotState()
      .then(data => {
        const slots = data.slots || [];
        const carsAvail = slots.filter(s => s.type === 'car' && s.status === 'available');
        const bikesAvail = slots.filter(s => s.type === 'bike' && s.status === 'available');

        setLotSummary({
          carsAvailable: carsAvail.length,
          bikesAvailable: bikesAvail.length,
        });

        const targetSlots = selectedVehicleType === 'car' ? carsAvail : bikesAvail;
        if (targetSlots.length > 0) {
          setNearestSlot(targetSlots[0]);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDriverState();

    const unsubSlot = wsClient.on('slot.updated', () => fetchDriverState());
    const unsubLot = wsClient.on('lot.state', () => fetchDriverState());

    return () => {
      unsubSlot();
      unsubLot();
    };
  }, [selectedVehicleType]);

  const handleSearchVehicle = (e) => {
    e.preventDefault();
    setSearchError('');
    setFoundVehicle(null);

    const plate = searchPlate.toUpperCase().trim();
    if (!plate) return;

    api.getSlots(`search=${encodeURIComponent(plate)}`)
      .then(results => {
        const match = results.find(s => s.current_vehicle && s.current_vehicle.toUpperCase() === plate);
        if (match) {
          setFoundVehicle(match);
        } else {
          setSearchError(`No active parked vehicle found for plate '${plate}'.`);
        }
      })
      .catch(() => setSearchError('Vehicle lookup failed.'));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans antialiased pb-12">
      
      {/* Top Mobile Kiosk Header */}
      <header className="h-16 border-b border-slate-800 px-4 sm:px-6 flex items-center justify-between bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white shadow-laser-blue">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-sm sm:text-base tracking-tight text-white leading-none">
              SmartPark AI
            </h1>
            <span className="text-[10px] font-mono text-availableGreen font-bold tracking-wider uppercase">
              GATE TERMINAL KIOSK
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-availableGreen text-xs font-mono font-bold">
          <span className="w-2 h-2 rounded-full bg-availableGreen animate-ping"></span>
          <span>LASERS ACTIVE</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 space-y-6">
        
        {/* Available Counts Banner */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setSelectedVehicleType('car')}
            className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
              selectedVehicleType === 'car'
                ? 'bg-blue-950/90 border-primary ring-2 ring-blue-500/40 shadow-laser-blue'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <Car className={`w-5 h-5 ${selectedVehicleType === 'car' ? 'text-primary' : 'text-slate-400'}`} />
              <span className="text-[10px] font-mono font-bold uppercase">Car Bays</span>
            </div>
            <div className="text-3xl font-black text-white">{lotSummary.carsAvailable}</div>
            <span className="text-xs text-availableGreen font-semibold">Available Now</span>
          </button>

          <button
            onClick={() => setSelectedVehicleType('bike')}
            className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
              selectedVehicleType === 'bike'
                ? 'bg-cyan-950/90 border-cyan-500 ring-2 ring-cyan-500/40 shadow-laser-cyan'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <Bike className={`w-5 h-5 ${selectedVehicleType === 'bike' ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span className="text-[10px] font-mono font-bold uppercase">2W Bays</span>
            </div>
            <div className="text-3xl font-black text-white">{lotSummary.bikesAvailable}</div>
            <span className="text-xs text-availableGreen font-semibold">Adaptive Ready</span>
          </button>
        </div>

        {/* Assigned Nearest Free Slot Guidance Card */}
        {nearestSlot ? (
          <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Navigation className="w-5 h-5 text-availableGreen animate-pulse" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  Recommended Vacant Bay
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-xs font-mono border border-blue-500/30">
                {nearestSlot.zone}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 block">Follow Ground Green Laser To:</span>
                <div className="text-4xl sm:text-5xl font-black text-availableGreen tracking-tight mt-0.5 font-mono">
                  {nearestSlot.id}
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-center">
                <Sparkles className="w-6 h-6 text-availableGreen mx-auto mb-1 animate-pulse" />
                <span className="text-[10px] font-mono text-emerald-300 font-bold block">520nm Laser Trail</span>
                <span className="text-[10px] text-slate-400">Illuminated on tarmac</span>
              </div>
            </div>

            {/* Minimal Top-Down Route Map Graphic */}
            <div className="relative w-full aspect-[16/9] bg-[#070B14] rounded-2xl border border-slate-800 p-2 overflow-hidden flex items-center justify-center">
              <svg className="w-full h-full" viewBox="0 0 320 180" fill="none">
                <rect x="10" y="10" width="300" height="160" rx="10" fill="#0A0F1D" stroke="#1E293B" strokeWidth="1.5" />
                
                {/* Gate */}
                <rect x="130" y="160" width="60" height="15" rx="3" fill="#1E3A8A" stroke="#2563EB" strokeWidth="1.5" />
                <text x="160" y="171" textAnchor="middle" fill="#93C5FD" fontSize="7" fontWeight="bold">ENTRY GATE</text>

                {/* Target Bay */}
                <rect x="60" y="30" width="50" height="40" rx="4" fill="#042F24" stroke="#22C55E" strokeWidth="2" filter="drop-shadow(0 0 8px #22C55E)" />
                <text x="85" y="55" textAnchor="middle" fill="#22C55E" fontSize="12" fontWeight="extrabold">{nearestSlot.id}</text>

                {/* Laser Route Arrow */}
                <path d="M 160 160 V 90 H 85 V 72" stroke="#22C55E" strokeWidth="2.5" strokeDasharray="6 4" className="animate-dash-flow" filter="drop-shadow(0 0 6px #22C55E)" />
                <polygon points="85,68 81,76 89,76" fill="#22C55E" />
              </svg>

              <div className="absolute bottom-2 left-3 right-3 text-center text-[10px] font-mono text-slate-400 bg-slate-900/80 rounded-lg py-1 border border-slate-800">
                Turn-by-turn guidance active • Direct path distance: 35m
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 text-center text-slate-400 text-xs">
            Lot is currently at full capacity for {selectedVehicleType.toUpperCase()}.
          </div>
        )}

        {/* Find My Vehicle Tool */}
        <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            <h3 className="font-extrabold text-sm text-white">Find My Parked Vehicle</h3>
          </div>
          <p className="text-xs text-slate-400">
            Enter your license plate number to locate your parked slot and dwell duration.
          </p>

          <form onSubmit={handleSearchVehicle} className="flex gap-2">
            <input
              type="text"
              required
              value={searchPlate}
              onChange={(e) => setSearchPlate(e.target.value)}
              placeholder="e.g. KA-01-AB-1234"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs font-mono font-bold uppercase focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-blue-700 font-bold text-xs text-white shadow-laser-blue cursor-pointer"
            >
              Locate
            </button>
          </form>

          {searchError && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300">
              {searchError}
            </div>
          )}

          {foundVehicle && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/40 space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white font-mono">{foundVehicle.current_vehicle}</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-availableGreen font-mono font-bold text-[10px]">
                  Parked in {foundVehicle.zone}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
                <span className="text-slate-400">Your Bay:</span>
                <strong className="text-availableGreen text-base font-mono font-extrabold">Slot {foundVehicle.id}</strong>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Parked Since:</span>
                <span className="font-mono text-slate-300">
                  {foundVehicle.occupied_since ? new Date(foundVehicle.occupied_since).toLocaleTimeString() : 'N/A'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Back to Control Room Link */}
        <div className="text-center pt-2">
          <a href="/" className="text-xs font-semibold text-slate-500 hover:text-white transition-colors">
            ← Switch to Operator Control Room
          </a>
        </div>

      </main>

    </div>
  );
}
