import React, { useState, useEffect, useRef } from 'react';
import {
  Package,
  TrendingUp,
  BarChart2,
  Search,
  Truck,
  DollarSign,
  Shield,
  Tag,
  Layers,
  Store,
  ArrowLeftRight,
  Box,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Wrench,
  Server,
  Database,
  Lock,
  Globe,
  Zap,
  FileText,
  Settings,
  Eye,
  Bell,
  Calculator,
  Users,
  ClipboardList,
  BarChart3,
  ScanBarcode,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  RotateCcw,
  LineChart,
  Gauge,
  Megaphone,
  Receipt,
} from 'lucide-react';

const featureTabs = [
  {
    id: 'source',
    label: 'Source',
    tagline: 'Find profitable products across 15+ platforms',
    features: [
      { icon: Store, title: '15+ Platforms', desc: 'Amazon, eBay, Walmart, AliExpress, Target, Best Buy, Faire, Keepa, and more.' },
      { icon: ArrowLeftRight, title: 'Cross-Platform Arbitrage', desc: 'Automatic price comparison, margin calculation, and opportunity scoring.' },
      { icon: Search, title: 'Auto-Scout Pipeline', desc: 'Configurable scouts that continuously scan for profitable products. Queue, approve, or auto-list.' },
      { icon: LineChart, title: 'Price Intelligence', desc: 'Historical price tracking, drop/spike detection, trend analysis, buy/sell signals.' },
      { icon: Gauge, title: 'Demand Scoring', desc: '6-signal model: velocity, stability, competitors, reviews, search interest, margin health.' },
      { icon: Shield, title: 'Restriction Checker', desc: 'Detect IP-restricted, gated, hazmat, and counterfeit-risk products before you list.' },
    ],
  },
  {
    id: 'automate',
    label: 'Automate',
    tagline: 'Set it and forget it — the agent handles the rest',
    features: [
      { icon: RefreshCw, title: 'Smart Repricing', desc: 'Algorithmic repricing that tracks competitors and adjusts your listings in real-time.' },
      { icon: Truck, title: 'Order-to-Fulfillment', desc: '12-state pipeline: detect sale → auto-purchase from source → push tracking to buyer.' },
      { icon: Layers, title: 'Multi-Channel Sync', desc: 'Buffer stock, oversell protection, cross-platform quantity sync in real-time.' },
      { icon: Bell, title: 'Alert System', desc: 'Price drops, stock changes, new opportunities, and order updates — all in real-time.' },
      { icon: Settings, title: 'Bulk Operations', desc: 'Mass edit listings, prices, inventory, and fulfillment settings across platforms.' },
      { icon: RotateCcw, title: 'Returns Processing', desc: 'Automated return handling, refund tracking, and restocking workflows.' },
    ],
  },
  {
    id: 'sell',
    label: 'Sell & Track',
    tagline: 'List everywhere, track every dollar',
    features: [
      { icon: Tag, title: 'Listing Creator', desc: 'Auto-create optimized listings on eBay and Amazon with AI-generated titles and descriptions.' },
      { icon: DollarSign, title: 'P&L Accounting', desc: 'Per-SKU profitability, tax summaries, monthly trends, cash flow, CSV/QuickBooks export.' },
      { icon: Users, title: 'Supplier CRM', desc: 'Manage suppliers, track orders, performance scoring, reorder alerts, price comparison.' },
      { icon: Eye, title: 'Web Dashboard', desc: 'Real-time overview of inventory, orders, profits, and alerts at /dashboard.' },
      { icon: Calculator, title: 'Fee Calculator', desc: 'Platform fees, shipping costs, and net margin per product — before you list.' },
      { icon: Receipt, title: 'Tax Compliance', desc: 'Multi-state tax calculations, exemption handling, and filing-ready reports.' },
    ],
  },
];

// Brand logo SVG components
const AmazonLogo = ({ size = 36, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
    <path d="M.045 18.02c.072-.116.187-.124.348-.022 2.344 1.474 4.882 2.21 7.613 2.21 1.965 0 3.928-.448 5.89-1.345.422-.19.76-.136 1.014.16.254.298.2.56-.164.786-1.792.98-3.722 1.554-5.792 1.648-2.614.12-5.058-.463-7.33-1.746-.196-.126-.296-.309-.204-.507l-.004.003.005-.004.054-.085.015-.026.054-.07zm21.774-2.152c.182.218.19.476.024.768-.3.526-.84 1.1-1.62 1.724-.18.144-.36.076-.54-.204l-.444-.744c-.348.456-.738.834-1.17 1.134-.432.3-.918.45-1.458.45-.636 0-1.116-.19-1.44-.568-.324-.378-.486-.878-.486-1.5 0-.792.264-1.434.792-1.926.528-.492 1.254-.738 2.178-.738.396 0 .81.048 1.242.144v-.48c0-.444-.096-.78-.288-1.008-.192-.228-.498-.342-.918-.342-.318 0-.678.054-1.08.162-.402.108-.786.252-1.152.432-.12.064-.216.03-.288-.102-.072-.132-.06-.252.036-.36.552-.612 1.386-1.044 2.502-1.296.378-.084.744-.126 1.098-.126.846 0 1.494.234 1.944.702.45.468.674 1.134.674 1.998v2.82c0 .294.09.504.27.63.18.126.38.186.6.186.108 0 .216-.012.324-.036.108-.024.168.006.18.09l.012.084zM15.4 15.57c0 .362.09.653.27.874.18.22.404.33.67.33.396 0 .762-.222 1.098-.666V14.49c-.324-.072-.654-.108-.99-.108-.438 0-.774.126-1.008.378-.234.252-.35.57-.35.954l.01-.005v-.14zm-3.6-2.478c0-.672-.156-1.2-.468-1.584-.312-.384-.744-.576-1.296-.576-.456 0-.9.132-1.332.396-.432.264-.756.618-.972 1.062v3.396c.432.576.96.864 1.584.864.576 0 1.026-.264 1.35-.792.324-.528.486-1.2.486-2.016v-.75h-.002zm-5.94 3.636c0 .204-.06.372-.18.504-.12.132-.276.198-.468.198-.192 0-.348-.066-.468-.198-.12-.132-.18-.3-.18-.504v-9.18c0-.204.06-.372.18-.504.12-.132.276-.198.468-.198.192 0 .348.066.468.198.12.132.18.3.18.504v3.6c.36-.516.798-.918 1.314-1.206.516-.288 1.068-.432 1.656-.432.768 0 1.38.306 1.836.918.456.612.684 1.404.684 2.376 0 1.08-.282 1.986-.846 2.718-.564.732-1.266 1.098-2.106 1.098-.744 0-1.386-.348-1.926-1.044v.546l-.001.002-.001-.001v.003z"/>
  </svg>
);

const EbayLogo = ({ size = 36, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
    <path d="M6.056 12.132v-4.92h1.2v3.026c.59-.703 1.402-.906 2.202-.906 1.34 0 2.828.904 2.828 2.855 0 .233-.015.457-.06.668.24-.953 1.274-1.305 2.896-1.344.51-.018 1.095-.018 1.56-.018v-.135c0-.885-.556-1.244-1.53-1.244-.72 0-1.245.3-1.305.81h-1.275c.136-1.29 1.5-1.62 2.686-1.62 1.064 0 1.995.27 2.415 1.02l-.436-.84h1.41l2.055 4.125 2.055-4.126H24l-3.72 7.305h-1.346l1.07-2.04-2.33-4.38c.13.255.2.555.2.93v2.46c0 .346.01.69.04 1.005H16.8a6.543 6.543 0 01-.046-.765c-.603.734-1.32.96-2.32.96-1.48 0-2.272-.78-2.272-1.695 0-.15.015-.284.037-.405-.3 1.246-1.36 2.086-2.767 2.086-.87 0-1.694-.315-2.2-.93 0 .24-.015.494-.04.734h-1.18c.02-.39.04-.855.04-1.245v-1.05h-4.83c.065 1.095.818 1.74 1.853 1.74.718 0 1.355-.3 1.568-.93h1.24c-.24 1.29-1.61 1.725-2.79 1.725C.95 15.009 0 13.822 0 12.232c0-1.754.982-2.91 3.116-2.91 1.688 0 2.93.886 2.94 2.806v.005zm9.137.183c-1.095.034-1.77.233-1.77.95 0 .465.36.97 1.305.97 1.26 0 1.935-.69 1.935-1.814v-.13c-.45 0-.99.006-1.484.022h.012zm-6.06 1.875c1.11 0 1.876-.806 1.876-2.02s-.768-2.02-1.893-2.02c-1.11 0-1.89.806-1.89 2.02s.765 2.02 1.875 2.02h.03zm-4.35-2.514c-.044-1.125-.854-1.546-1.725-1.546-.944 0-1.694.474-1.815 1.546z"/>
  </svg>
);

const WalmartLogo = ({ size = 36, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
    <path d="M12 0L13.608 5.832L12 9.6L10.392 5.832L12 0ZM12 14.4L13.608 18.168L12 24L10.392 18.168L12 14.4ZM24 12L18.168 13.608L14.4 12L18.168 10.392L24 12ZM9.6 12L5.832 13.608L0 12L5.832 10.392L9.6 12ZM20.784 3.216L16.488 7.008L13.68 5.568L15.12 2.76L20.784 3.216ZM10.32 18.432L8.88 21.24L3.216 20.784L7.512 16.992L10.32 18.432ZM20.784 20.784L15.12 21.24L13.68 18.432L16.488 16.992L20.784 20.784ZM7.512 7.008L3.216 3.216L8.88 2.76L10.32 5.568L7.512 7.008Z"/>
  </svg>
);

const AliExpressLogo = ({ size = 36, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
    <path d="M5.166 9.096a.022.022 0 0 0-.022.021c0 .396-.32.717-.713.717a.021.021 0 0 0-.021.022c0 .012.01.021.021.021.394 0 .713.322.713.718 0 .012.01.021.022.021.011 0 .021-.01.021-.021A.717.717 0 0 1 5.9 9.88a.021.021 0 0 0 0-.043.716.716 0 0 1-.713-.718v-.002a.021.021 0 0 0-.021-.021zm-3.693.526L0 13.462h.48l.355-.922h1.782l.354.922h.481L1.98 9.622zm2.264.002v3.838h.491V9.624zm2.375 0v3.838h2.413v-.502H6.613v-1.19H8.19v-.477H6.613v-1.166h1.773v-.502zm-4.386.592l.698 1.82H1.028zM24 12.832l-3.72 7.305h-1.346l1.07-2.04L17.674 13.717c.13.255.2.555.2.93v2.46c0 .346.01.69.04 1.005z"/>
  </svg>
);

const TargetLogo = ({ size = 36, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
    <path d="M12 0C18.627 0 24 5.373 24 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0zm0 4.225a7.826 7.826 0 100 15.55 7.826 7.826 0 000-15.55zm0 3.841a3.84 3.84 0 110 7.68 3.84 3.84 0 010-7.68z"/>
  </svg>
);

const BestBuyLogo = ({ size = 36, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
    <path d="M2.4 3.6h6v4.8h-6zm7.2 0h6v4.8h-6zm7.2 0h4.8v4.8h-4.8zM2.4 9.6h6v4.8h-6zm7.2 0h6v4.8h-6zm7.2 0h4.8v4.8h-4.8zM2.4 15.6h6v4.8h-6zm7.2 0h6v4.8h-6zm7.2 0h4.8v4.8h-4.8z"/>
  </svg>
);

const stats = [
  { value: '435+', label: 'Tools', icon: Wrench },
  { value: '15+', label: 'Platforms', icon: Store },
  { value: '30', label: 'Migrations', icon: ArrowLeftRight },
  { value: '91', label: 'New Features', icon: Zap },
  { icon: Globe, label: 'Open Source' },
  { icon: Server, label: 'Self-Hosted' },
  { icon: Database, label: 'SQLite DB' },
  { value: '1%', label: 'Platform Fee', icon: DollarSign },
];

const codeExample = `# Install & run
git clone https://github.com/alsk1992/Flip-God
cd flipgod && npm install && npm run build
npm start

# The agent starts on http://localhost:18789
# Chat: "scan amazon for wireless earbuds under $20"
# Or: "find arbitrage opportunities in electronics"`;

const advancedFeatures = [
  { icon: Search, title: 'Auto-Scout Pipeline', desc: 'Continuous product scanning with configurable filters, queuing, and auto-listing', color: 'emerald' },
  { icon: RefreshCw, title: 'Smart Repricing', desc: 'Algorithmic competitor tracking and real-time price adjustments', color: 'green' },
  { icon: Truck, title: 'Fulfillment Chain', desc: '12-state pipeline from sale detection to tracking push', color: 'purple' },
  { icon: LineChart, title: 'Price Intelligence', desc: 'Historical tracking, drop/spike detection, trend analysis', color: 'red' },
  { icon: Gauge, title: 'Demand Scoring', desc: '6-signal scoring: velocity, stability, competitors, reviews, interest, margin', color: 'yellow' },
  { icon: Shield, title: 'Restriction Checker', desc: 'IP-restricted, gated, hazmat, and counterfeit-risk detection', color: 'blue' },
  { icon: Layers, title: 'Multi-Channel Sync', desc: 'Buffer stock, oversell protection, cross-platform quantity sync', color: 'pink' },
  { icon: BarChart2, title: 'P&L Reports', desc: 'Per-SKU profitability, tax summaries, CSV/QuickBooks export', color: 'orange' },
  { icon: Users, title: 'Supplier CRM', desc: 'Supplier management, performance scoring, reorder alerts', color: 'emerald' },
  { icon: Eye, title: 'Web Dashboard', desc: 'Real-time overview of inventory, orders, profits, and alerts', color: 'green' },
  { icon: Calculator, title: 'Fee Calculator', desc: 'Platform fees, shipping costs, and net margin per product', color: 'purple' },
  { icon: ClipboardList, title: 'Category Browser', desc: 'Explore categories across platforms to find profitable niches', color: 'red' },
  { icon: Upload, title: 'Wholesale CSV Import', desc: 'Bulk import supplier catalogs and scan for arbitrage at scale', color: 'yellow' },
  { icon: ScanBarcode, title: 'Barcode Scanner', desc: 'UPC/EAN lookup across all platforms for instant price comparison', color: 'blue' },
  { icon: Megaphone, title: 'SEO Optimizer', desc: 'AI-generated titles, descriptions, and keywords for maximum visibility', color: 'pink' },
  { icon: FileText, title: 'Listing Templates', desc: 'Reusable templates for consistent, high-converting product listings', color: 'orange' },
  { icon: BarChart3, title: 'Competitor Monitoring', desc: 'Track competitor prices, stock levels, and listing changes', color: 'emerald' },
  { icon: Box, title: 'Shipping Rate Cache', desc: 'Pre-calculated shipping costs for instant margin estimates', color: 'green' },
  { icon: Bell, title: 'Alert System', desc: 'Price drops, stock changes, new opportunities, and order updates', color: 'purple' },
  { icon: Settings, title: 'Bulk Operations', desc: 'Mass edit listings, prices, inventory, and fulfillment settings', color: 'red' },
  { icon: Receipt, title: 'Tax Compliance', desc: 'Multi-state tax calculations, exemption handling, filing reports', color: 'yellow' },
  { icon: RotateCcw, title: 'Returns Processing', desc: 'Automated return handling, refund tracking, and restocking', color: 'blue' },
  { icon: TrendingUp, title: 'Inventory Forecasting', desc: 'Demand prediction, reorder timing, and seasonal trend analysis', color: 'pink' },
  { icon: Tag, title: 'Dynamic Pricing', desc: 'AI-driven price optimization based on demand, competition, and margins', color: 'orange' },
];

function PlatformsSection() {
  const [platformSlide, setPlatformSlide] = useState(0);

  const sourcePlatforms = [
    { name: 'Amazon', icon: AmazonLogo, status: 'PA-API + SP-API' },
    { name: 'Walmart', icon: WalmartLogo, status: 'Affiliate' },
    { name: 'AliExpress', icon: AliExpressLogo, status: 'Affiliate' },
    { name: 'Target', icon: TargetLogo, status: 'API' },
    { name: 'Best Buy', icon: BestBuyLogo, status: 'API' },
    { name: 'Faire', icon: Package, status: 'Wholesale' },
  ];

  const sellPlatforms = [
    { name: 'eBay', icon: EbayLogo, status: 'Browse + Inventory + Fulfillment' },
    { name: 'Amazon Seller', icon: AmazonLogo, status: 'SP-API' },
    { name: 'Walmart Marketplace', icon: WalmartLogo, status: 'Seller API' },
  ];

  const dataTracking = [
    { name: 'Keepa', icon: LineChart, status: 'Price History' },
    { name: 'EasyPost', icon: Truck, status: 'Shipping' },
    { name: 'Ship24', icon: Box, status: 'Tracking' },
    { name: 'Barcode Lookup', icon: ScanBarcode, status: 'UPC/EAN' },
  ];

  const slides = [
    { title: 'Source Platforms', subtitle: 'Find products at the lowest prices from major retailers and wholesalers', markets: sourcePlatforms },
    { title: 'Sell Platforms', subtitle: 'List and sell across multiple marketplaces simultaneously', markets: sellPlatforms },
    { title: 'Data & Tracking', subtitle: 'Price history, shipping rates, and package tracking integrations', markets: dataTracking },
  ];

  const currentSlide = slides[platformSlide];

  return (
    <section className="relative z-10 py-20 px-6 bg-emerald-950/20">
      <div className="max-w-4xl mx-auto">
        <h2
          className="text-3xl md:text-4xl font-bold text-center mb-2"
          style={{
            fontFamily: "'Russo One', sans-serif",
            background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
          }}
        >
          Connected to every platform
        </h2>
        <p className="text-emerald-300/60 text-center mb-4">
          {currentSlide.subtitle}
        </p>

        {/* Slide indicator pills */}
        <div className="flex justify-center gap-2 mb-8">
          {slides.map((slide, idx) => (
            <button
              key={idx}
              onClick={() => setPlatformSlide(idx)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                idx === platformSlide
                  ? 'bg-emerald-500 text-slate-900'
                  : 'bg-emerald-900/40 text-emerald-200/70 hover:bg-emerald-800/40'
              }`}
            >
              {slide.title}
            </button>
          ))}
        </div>

        <div className="relative">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {currentSlide.markets.map((market) => {
              const Icon = market.icon;
              return (
                <div
                  key={market.name}
                  className="flex flex-col items-center gap-2 p-5 bg-emerald-950/30 border border-emerald-900/40 rounded-xl hover:border-emerald-500/50 transition-colors"
                >
                  <Icon size={36} className="text-emerald-400" />
                  <span className="text-white font-medium" style={{ fontFamily: "'Russo One', sans-serif" }}>{market.name}</span>
                  <span className="text-xs text-green-400">{market.status}</span>
                </div>
              );
            })}
          </div>

          {/* Navigation arrows */}
          <div className="absolute top-1/2 -translate-y-1/2 -left-12 hidden md:block">
            <button
              onClick={() => setPlatformSlide((p) => (p === 0 ? slides.length - 1 : p - 1))}
              className="p-2 rounded-full bg-emerald-950/50 border border-emerald-900/40 text-emerald-300/60 hover:text-emerald-400 hover:border-emerald-400/50 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 -right-12 hidden md:block">
            <button
              onClick={() => setPlatformSlide((p) => (p === slides.length - 1 ? 0 : p + 1))}
              className="p-2 rounded-full bg-emerald-950/50 border border-emerald-900/40 text-emerald-300/60 hover:text-emerald-400 hover:border-emerald-400/50 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Dot indicators */}
        <div className="flex justify-center gap-2 mt-6">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setPlatformSlide(idx)}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === platformSlide ? 'bg-emerald-400' : 'bg-emerald-800/40 hover:bg-emerald-700/40'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AdvancedFeaturesSection() {
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 4;
  const totalPages = Math.ceil(advancedFeatures.length / itemsPerPage);

  const colorMap = {
    emerald: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    green: 'text-green-400 bg-green-400/10 border-green-400/30',
    purple: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
    red: 'text-red-400 bg-red-400/10 border-red-400/30',
    yellow: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
    pink: 'text-pink-400 bg-pink-400/10 border-pink-400/30',
    orange: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  };

  const currentFeatures = advancedFeatures.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  return (
    <section className="relative z-10 py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <h2
          className="text-3xl md:text-4xl font-bold text-center mb-2"
          style={{
            fontFamily: "'Russo One', sans-serif",
            background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
          }}
        >
          Advanced Arbitrage Features
        </h2>
        <p className="text-emerald-300/60 text-center mb-10">
          Professional-grade tools for serious resellers.
        </p>

        <div className="relative">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {currentFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className={`p-5 rounded-xl border transition-all hover:scale-105 ${colorMap[feature.color]}`}
                >
                  <Icon size={28} className="mb-3" />
                  <h3 className="text-sm font-semibold text-white mb-2" style={{ fontFamily: "'Russo One', sans-serif" }}>{feature.title}</h3>
                  <p className="text-xs text-emerald-300/60">{feature.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-2 rounded-full bg-emerald-950/50 border border-emerald-900/40 text-emerald-300/60 hover:text-emerald-400 hover:border-emerald-400/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="flex gap-2">
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === currentPage ? 'bg-emerald-400' : 'bg-emerald-800/40 hover:bg-emerald-700/40'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="p-2 rounded-full bg-emerald-950/50 border border-emerald-900/40 text-emerald-300/60 hover:text-emerald-400 hover:border-emerald-400/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const sectionRef = useRef(null);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [displayValues, setDisplayValues] = useState(
    stats.map((s) => (s.value ? '0' : null))
  );

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);

          const duration = 1500;
          const startTime = performance.now();

          const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

          const animate = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutQuart(progress);

            setDisplayValues(
              stats.map((stat) => {
                if (!stat.value) return null;
                const numericMatch = stat.value.match(/^(\d+)/);
                if (!numericMatch) return stat.value;
                const target = parseInt(numericMatch[1], 10);
                const suffix = stat.value.replace(/^\d+/, '');
                const current = Math.round(target * eased);
                return `${current}${suffix}`;
              })
            );

            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnimated]);

  return (
    <section ref={sectionRef} className="relative z-10 py-12 border-y border-emerald-900/30">
      <div className="max-w-4xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-emerald-400 flex justify-center" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  {stat.value ? displayValues[idx] : <Icon size={36} strokeWidth={1.5} />}
                </div>
                <div className="text-emerald-300/60 text-sm mt-1">{stat.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState('source');

  return (
    <div className="min-h-screen relative" style={{ background: '#040d04' }}>
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        background: `
          radial-gradient(ellipse 80% 50% at 20% 20%, rgba(5, 150, 105, 0.12) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 60%, rgba(52, 211, 153, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse 90% 60% at 50% 100%, rgba(5, 150, 105, 0.10) 0%, transparent 50%),
          linear-gradient(180deg, #040d04 0%, #061208 30%, #040d04 60%, #030a03 100%)
        `,
      }} />

      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 backdrop-blur-md border-b border-emerald-900/30" style={{ background: 'rgba(4, 13, 4, 0.9)' }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="FlipGod" className="h-10 w-auto" />
          </a>
          <div className="flex items-center gap-6">
            <a href="/docs" className="text-emerald-200/70 hover:text-white transition-colors">Docs</a>
            <a
              href="https://github.com/alsk1992/Flip-God"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-200/70 hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a
              href="/docs#quickstart"
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-medium rounded-lg transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 pb-16 px-6 z-10 overflow-hidden">
        {/* Hero glow behind logo */}
        <div className="absolute top-1/2 right-[15%] -translate-y-1/2 w-[600px] h-[600px] pointer-events-none" style={{
          background: 'radial-gradient(circle, rgba(52, 211, 153, 0.15) 0%, rgba(5, 150, 105, 0.05) 40%, transparent 70%)',
        }} />
        <div className="max-w-6xl mx-auto relative">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left - Text */}
            <div>
              <h1
                className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 leading-tight"
                style={{
                  fontFamily: "'Russo One', sans-serif",
                  background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 0 20px rgba(52, 211, 153, 0.5))',
                }}
              >
                AI-Powered<br />E-Commerce Arbitrage
              </h1>
              <p className="text-xl mb-8" style={{ color: '#a7c4b8', textShadow: '0 0 10px rgba(52, 211, 153, 0.3)' }}>
                Find deals. List automatically. Profit on every flip. Powered by Claude.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="/docs#quickstart"
                  className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded-lg transition-colors text-lg text-center"
                >
                  Quick Start
                </a>
                <a
                  href="https://github.com/alsk1992/Flip-God"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-3 border border-emerald-700/50 hover:border-emerald-500/50 text-white font-semibold rounded-lg transition-colors text-lg flex items-center justify-center gap-2"
                  style={{ background: 'rgba(5, 150, 105, 0.1)' }}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                  </svg>
                  View on GitHub
                </a>
              </div>
            </div>

            {/* Right - Logo */}
            <div className="flex justify-center md:justify-end">
              <img src="/logo.png" alt="FlipGod" className="w-72 md:w-80 lg:w-96 h-auto drop-shadow-2xl" style={{
                filter: 'drop-shadow(0 0 40px rgba(52, 211, 153, 0.3))',
              }} />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-12"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
            }}
          >
            How it works
          </h2>

          {/* Desktop: horizontal with arrows */}
          <div className="hidden md:flex items-start justify-center gap-0">
            {[
              { step: 1, title: 'Source', Icon: Search, desc: 'Scan 15+ platforms for underpriced products. AI scores every opportunity by margin, demand, and risk.' },
              { step: 2, title: 'List', Icon: Tag, desc: 'Auto-create optimized listings on eBay and Amazon. AI writes titles, descriptions, and sets competitive prices.' },
              { step: 3, title: 'Profit', Icon: DollarSign, desc: 'Orders fulfilled automatically. Track every dollar with real-time P&L dashboards.' },
            ].map((item, idx) => (
              <React.Fragment key={item.step}>
                <div className="flex flex-col items-center text-center max-w-[220px]">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 text-slate-900 font-bold flex items-center justify-center text-lg mb-4">
                    {item.step}
                  </div>
                  <item.Icon size={32} className="text-emerald-400 mb-3" />
                  <h3 className="text-white font-semibold mb-2" style={{ fontFamily: "'Russo One', sans-serif" }}>{item.title}</h3>
                  <p className="text-emerald-300/60 text-sm leading-relaxed">{item.desc}</p>
                </div>
                {idx < 2 && (
                  <div className="hidden md:flex items-center px-4 pt-4">
                    <ChevronRight size={24} className="text-emerald-800" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Mobile: vertical with dashed line */}
          <div className="flex md:hidden flex-col items-center gap-0">
            {[
              { step: 1, title: 'Source', Icon: Search, desc: 'Scan 15+ platforms for underpriced products. AI scores every opportunity by margin, demand, and risk.' },
              { step: 2, title: 'List', Icon: Tag, desc: 'Auto-create optimized listings on eBay and Amazon. AI writes titles, descriptions, and sets competitive prices.' },
              { step: 3, title: 'Profit', Icon: DollarSign, desc: 'Orders fulfilled automatically. Track every dollar with real-time P&L dashboards.' },
            ].map((item, idx) => (
              <React.Fragment key={item.step}>
                <div className="flex flex-col items-center text-center max-w-[260px]">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 text-slate-900 font-bold flex items-center justify-center text-lg mb-4">
                    {item.step}
                  </div>
                  <item.Icon size={32} className="text-emerald-400 mb-3" />
                  <h3 className="text-white font-semibold mb-2" style={{ fontFamily: "'Russo One', sans-serif" }}>{item.title}</h3>
                  <p className="text-emerald-300/60 text-sm leading-relaxed">{item.desc}</p>
                </div>
                {idx < 2 && (
                  <div className="w-px h-8 border-l border-dashed border-emerald-800 my-2" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <StatsSection />

      {/* Features - Interactive Tabs */}
      <section className="relative z-10 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
            }}
          >
            Everything you need
          </h2>
          <p className="text-emerald-300/60 text-center mb-10">
            A complete platform for e-commerce arbitrage, sourcing, and automation.
          </p>

          {/* Tab buttons */}
          <div className="flex justify-center mb-2">
            <div className="inline-flex bg-emerald-950/50 rounded-xl p-1 border border-emerald-900/30">
              {featureTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-emerald-500 text-slate-900 shadow-lg shadow-emerald-500/25'
                      : 'text-emerald-300/60 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab tagline */}
          <p className="text-emerald-400/40 text-center text-sm mb-8">
            {featureTabs.find((t) => t.id === activeTab)?.tagline}
          </p>

          {/* Feature cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featureTabs
              .find((t) => t.id === activeTab)
              ?.features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className="group p-5 rounded-xl bg-emerald-950/30 border border-emerald-900/30 hover:border-emerald-500/40 transition-all duration-200 hover:bg-emerald-950/50"
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors shrink-0">
                        <Icon size={20} />
                      </div>
                      <div>
                        <h3 className="text-white font-medium mb-1" style={{ fontFamily: "'Russo One', sans-serif" }}>{feature.title}</h3>
                        <p className="text-emerald-300/60 text-sm leading-relaxed">{feature.desc}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      {/* Platforms */}
      <PlatformsSection />

      {/* Advanced Features */}
      <AdvancedFeaturesSection />

      {/* Code Example */}
      <section className="relative z-10 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
            }}
          >
            Up and running in seconds
          </h2>
          <p className="text-emerald-300/60 text-center mb-10">
            Clone, build, and start flipping. Self-hosted, zero fees.
          </p>

          <div className="bg-emerald-950/30 rounded-xl border border-emerald-900/40 overflow-hidden">
            <div className="px-6 py-4 bg-emerald-950/50 border-b border-emerald-900/40">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white" style={{ fontFamily: "'Russo One', sans-serif" }}>Self-Hosted</h3>
                  <p className="text-emerald-300/60 text-sm">Full features, your machine, your data</p>
                </div>
                <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">Recommended</span>
              </div>
            </div>
            <pre className="p-4 overflow-x-auto">
              <code className="text-xs text-emerald-200/70 font-mono whitespace-pre">{codeExample}</code>
            </pre>
            <div className="px-6 py-3 bg-emerald-950/30 border-t border-emerald-900/40 text-xs text-emerald-300/60">
              15+ platforms &bull; Auto-scout &bull; Repricing &bull; Fulfillment &bull; P&L
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
            }}
          >
            FAQ & Security
          </h2>
          <p className="text-emerald-300/60 text-center mb-10">
            Your keys, your data, your profits.
          </p>

          <div className="space-y-4">
            {[
              {
                q: 'Is my data secure?',
                a: 'Yes. FlipGod runs entirely on your machine. All data is stored in a local SQLite database. Your API keys and credentials never leave your server.',
              },
              {
                q: 'Which platforms are supported?',
                a: 'Amazon (PA-API + SP-API), eBay (Browse + Inventory + Fulfillment APIs), Walmart (Affiliate + Marketplace), AliExpress, Target, Best Buy, Faire, Keepa, EasyPost, Ship24, and Barcode Lookup.',
              },
              {
                q: 'Can it auto-list products?',
                a: 'Yes. FlipGod can automatically create listings on eBay via the Inventory API and on Amazon via SP-API. Configure approval rules or let the auto-scout pipeline handle it end-to-end.',
              },
              {
                q: 'Does it handle fulfillment?',
                a: 'Yes. The 12-state order-to-fulfillment pipeline covers the entire flow: sale detection, source purchase, payment confirmation, shipping label creation, tracking number push to the buyer, and delivery confirmation.',
              },
              {
                q: 'Is it open source?',
                a: 'Yes, 100% open source under the MIT license. You can audit every line of code, fork it, modify it, or self-host it however you want.',
              },
            ].map((faq, idx) => (
              <div
                key={idx}
                className="p-5 bg-emerald-950/30 rounded-xl border border-emerald-900/40"
              >
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  <Shield size={18} className="text-emerald-400" />
                  {faq.q}
                </h3>
                <p className="text-emerald-300/60 text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-emerald-950/20">
        <div className="max-w-2xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl font-bold mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #34d399 50%, #059669 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(52, 211, 153, 0.4))',
            }}
          >
            Ready to start flipping?
          </h2>
          <p className="text-emerald-300/60 mb-8">
            FlipGod is free, open source, and self-hosted. Your keys, your data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/docs"
              className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded-lg transition-colors"
            >
              Get Started
            </a>
            <a
              href="https://github.com/alsk1992/Flip-God"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 bg-emerald-900/40 hover:bg-emerald-800/40 text-white font-semibold rounded-lg transition-colors"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-6 border-t border-emerald-900/40">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="FlipGod" className="h-8 w-auto" />
            <span className="text-emerald-400/40 text-sm">AI E-Commerce Arbitrage</span>
          </div>
          <div className="flex items-center gap-6 text-emerald-300/60 text-sm">
            <a href="/docs" className="hover:text-white transition-colors">Docs</a>
            <a href="https://github.com/alsk1992/Flip-God" className="hover:text-white transition-colors">GitHub</a>
            <span>MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
