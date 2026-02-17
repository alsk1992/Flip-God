import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Rocket,
  Settings,
  KeyRound,
  ShoppingCart,
  Store,
  Tag,
  Globe,
  Package,
  Search,
  ArrowLeftRight,
  Calculator,
  FileText,
  Zap,
  RefreshCw,
  Truck,
  LineChart,
  BarChart2,
  DollarSign,
  ShieldCheck,
  Layers,
  Users,
  Monitor,
  BookOpen,
  Server,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Info,
  ArrowLeft,
  Terminal,
  Box,
  TrendingUp,
  Clock,
  Target,
  Gauge,
  CircleDot,
  Database,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Navigation tree
// ---------------------------------------------------------------------------

const NAV_SECTIONS = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: Rocket,
    children: [
      { id: 'quick-start', label: 'Quick Start' },
      { id: 'configuration', label: 'Configuration' },
      { id: 'setting-up-credentials', label: 'Setting Up Credentials' },
    ],
  },
  {
    id: 'platforms',
    label: 'Platforms',
    icon: Store,
    children: [
      { id: 'platform-amazon', label: 'Amazon' },
      { id: 'platform-ebay', label: 'eBay' },
      { id: 'platform-walmart', label: 'Walmart' },
      { id: 'platform-aliexpress', label: 'AliExpress' },
      { id: 'platform-others', label: 'Others' },
    ],
  },
  {
    id: 'core-features',
    label: 'Core Features',
    icon: Search,
    children: [
      { id: 'arbitrage-scanner', label: 'Arbitrage Scanner' },
      { id: 'product-matching', label: 'Product Matching' },
      { id: 'fee-calculator', label: 'Fee Calculator' },
      { id: 'listing-creator', label: 'Listing Creator' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: Zap,
    children: [
      { id: 'auto-scout-pipeline', label: 'Auto-Scout Pipeline' },
      { id: 'smart-repricing', label: 'Smart Repricing' },
      { id: 'fulfillment-chain', label: 'Fulfillment Chain' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: LineChart,
    children: [
      { id: 'price-intelligence', label: 'Price Intelligence' },
      { id: 'demand-scoring', label: 'Demand Scoring' },
      { id: 'pnl-reports', label: 'P&L Reports' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Settings,
    children: [
      { id: 'restriction-checker', label: 'Restriction Checker' },
      { id: 'multi-channel-sync', label: 'Multi-Channel Sync' },
      { id: 'supplier-crm', label: 'Supplier CRM' },
      { id: 'web-dashboard', label: 'Web Dashboard' },
    ],
  },
  {
    id: 'api-reference',
    label: 'API Reference',
    icon: Server,
    children: [
      { id: 'tool-list', label: 'Tool List' },
      { id: 'rest-api', label: 'REST API' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Reusable tiny components
// ---------------------------------------------------------------------------

function CodeBlock({ children, language = 'bash', title }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="my-4 rounded-lg overflow-hidden border border-slate-700">
      {title && (
        <div className="flex items-center justify-between bg-slate-800 px-4 py-2 border-b border-slate-700">
          <span className="text-xs font-medium text-slate-400">{title}</span>
          <span className="text-xs text-slate-500">{language}</span>
        </div>
      )}
      <div className="relative bg-slate-950 group">
        <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
          <code className="text-emerald-400 font-mono">{children}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 p-1.5 rounded bg-slate-800 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Copy code"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function InlineCode({ children }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 text-sm font-mono border border-slate-700">
      {children}
    </code>
  );
}

function Callout({ type = 'info', children }) {
  const styles = {
    info: {
      border: 'border-blue-500',
      bg: 'bg-blue-500/10',
      icon: <Info size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />,
    },
    warning: {
      border: 'border-amber-500',
      bg: 'bg-amber-500/10',
      icon: <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />,
    },
  };
  const s = styles[type] || styles.info;
  return (
    <div className={`my-4 flex gap-3 p-4 rounded-r-lg border-l-4 ${s.border} ${s.bg}`}>
      {s.icon}
      <div className="text-sm text-slate-300 leading-relaxed">{children}</div>
    </div>
  );
}

function SectionHeading({ id, children }) {
  return (
    <h2 id={id} className="text-2xl font-bold text-white mt-12 mb-4 scroll-mt-20 flex items-center gap-2">
      {children}
    </h2>
  );
}

function SubHeading({ children }) {
  return <h3 className="text-lg font-semibold text-slate-200 mt-8 mb-3">{children}</h3>;
}

function Paragraph({ children }) {
  return <p className="text-slate-400 leading-relaxed mb-4">{children}</p>;
}

function EnvTable({ rows }) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800">
            <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Variable</th>
            <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, desc], i) => (
            <tr key={key} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/50'}>
              <td className="px-4 py-2 font-mono text-emerald-400 whitespace-nowrap">{key}</td>
              <td className="px-4 py-2 text-slate-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiList({ items }) {
  return (
    <ul className="my-3 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-slate-400">
          <ChevronRight size={14} className="text-emerald-500 flex-shrink-0 mt-1" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Section content renderers
// ---------------------------------------------------------------------------

function QuickStartSection() {
  return (
    <>
      <SectionHeading id="quick-start">Quick Start</SectionHeading>
      <Paragraph>
        Get FlipGod running in under two minutes. You need Node.js 18+ and an Anthropic API key.
      </Paragraph>
      <CodeBlock title="Install and run" language="bash">{
`git clone https://github.com/alsk1992/Flip-God.git
cd flipgod
npm install
npm run build
npm start`
      }</CodeBlock>
      <Paragraph>
        On first launch FlipGod opens an interactive onboarding wizard that walks you through API key
        setup for each platform you want to use. You can also configure everything via environment
        variables or the chat interface later.
      </Paragraph>
      <Callout type="info">
        FlipGod runs locally on your machine. No data is sent to third-party servers beyond the
        platform APIs you explicitly configure.
      </Callout>
    </>
  );
}

function ConfigurationSection() {
  return (
    <>
      <SectionHeading id="configuration">Configuration</SectionHeading>
      <Paragraph>
        All configuration is managed through environment variables. Create a <InlineCode>.env</InlineCode> file
        in the project root or export them in your shell.
      </Paragraph>
      <EnvTable rows={[
        ['ANTHROPIC_API_KEY', 'Required. Your Anthropic API key for the AI agent.'],
        ['AMAZON_ACCESS_KEY', 'Amazon Product Advertising API access key.'],
        ['AMAZON_SECRET_KEY', 'Amazon Product Advertising API secret key.'],
        ['AMAZON_PARTNER_TAG', 'Your Amazon Associates partner tag (e.g. mytag-20).'],
        ['EBAY_CLIENT_ID', 'eBay developer application client ID (OAuth2).'],
        ['EBAY_CLIENT_SECRET', 'eBay developer application client secret.'],
        ['WALMART_API_KEY', 'Walmart Affiliate or Marketplace API key.'],
        ['ALIEXPRESS_APP_KEY', 'AliExpress Open Platform app key.'],
        ['ALIEXPRESS_APP_SECRET', 'AliExpress Open Platform app secret.'],
        ['EASYPOST_API_KEY', 'EasyPost shipping API key for rate comparison.'],
      ]} />
      <CodeBlock title=".env example" language="bash">{
`ANTHROPIC_API_KEY=sk-ant-...
AMAZON_ACCESS_KEY=AKIA...
AMAZON_SECRET_KEY=wJalr...
AMAZON_PARTNER_TAG=flipgod-20
EBAY_CLIENT_ID=FlipAgen-prod-...
EBAY_CLIENT_SECRET=PRD-...
WALMART_API_KEY=...
ALIEXPRESS_APP_KEY=...
ALIEXPRESS_APP_SECRET=...
EASYPOST_API_KEY=EZ...`
      }</CodeBlock>
    </>
  );
}

function SettingUpCredentialsSection() {
  return (
    <>
      <SectionHeading id="setting-up-credentials">Setting Up Credentials</SectionHeading>
      <Paragraph>
        The easiest way to add platform credentials is through the chat interface.
        FlipGod walks you through each step interactively.
      </Paragraph>
      <CodeBlock title="Chat command" language="text">{
`> setup amazon credentials

FlipGod: Let's set up your Amazon PA-API credentials.
  1. Go to https://affiliate-program.amazon.com
  2. Navigate to Tools > Product Advertising API
  3. Generate a new key pair
  Paste your Access Key: ****
  Paste your Secret Key: ****
  Enter your Partner Tag: mytag-20

  Credentials saved. Testing connection...
  Connected to Amazon PA-API v5.`
      }</CodeBlock>
      <Paragraph>
        Credentials are stored locally in <InlineCode>~/.flipgod/credentials.json</InlineCode> with
        file-system-level permissions (chmod 600). You can also manage them
        with <InlineCode>setup ebay credentials</InlineCode>, <InlineCode>setup walmart credentials</InlineCode>,
        and so on for every supported platform.
      </Paragraph>
    </>
  );
}

function PlatformAmazonSection() {
  return (
    <>
      <SectionHeading id="platform-amazon">Amazon</SectionHeading>
      <Paragraph>
        FlipGod uses two Amazon APIs: the Product Advertising API (PA-API v5) for product search and
        lookup, and the Selling Partner API (SP-API) for listing management and order fulfillment.
      </Paragraph>
      <SubHeading>PA-API (Product Advertising)</SubHeading>
      <ApiList items={[
        'SearchItems -- keyword and category search with price, availability, and offer data',
        'GetItems -- ASIN lookup for detailed product information (images, features, dimensions)',
        'GetBrowseNodes -- category tree traversal for niche discovery',
      ]} />
      <CodeBlock title="Search via chat" language="text">{
`> search amazon for "wireless earbuds" under $30

Found 10 results:
  1. SoundCore A20  -- $22.99  (BSR #142 in Electronics)
  2. JLab Go Air   -- $19.88  (BSR #87 in Electronics)
  ...`
      }</CodeBlock>
      <SubHeading>SP-API (Selling Partner)</SubHeading>
      <ApiList items={[
        'ListCatalogItem -- check if a product already exists in Amazon catalog',
        'UpdatePricing -- set or adjust your offer price',
        'GetOrders -- retrieve recent orders and fulfillment status',
        'CreateFulfillmentOrder -- send FBA shipment requests',
      ]} />
      <Callout type="warning">
        SP-API requires a Professional Seller account and app registration in Seller Central.
        FlipGod handles the LWA OAuth2 token refresh automatically once you provide the initial
        refresh token.
      </Callout>
    </>
  );
}

function PlatformEbaySection() {
  return (
    <>
      <SectionHeading id="platform-ebay">eBay</SectionHeading>
      <Paragraph>
        eBay integration uses the REST APIs with OAuth2 client_credentials flow for public data and
        authorization_code flow for seller actions.
      </Paragraph>
      <SubHeading>Browse API</SubHeading>
      <ApiList items={[
        'search -- keyword search with category, price range, and condition filters',
        'getItem -- full listing details including seller info and shipping options',
        'getItemsByItemGroup -- variation listings (size, color) grouped together',
      ]} />
      <SubHeading>Inventory API</SubHeading>
      <ApiList items={[
        'createOrReplaceInventoryItem -- create/update SKU with quantity, condition, description',
        'createOffer -- associate an inventory item with a listing (price, marketplace, format)',
        'publishOffer -- push a draft offer live on eBay',
      ]} />
      <SubHeading>Fulfillment API</SubHeading>
      <ApiList items={[
        'getOrders -- fetch sold items with buyer details',
        'createShippingFulfillment -- upload tracking info to mark items shipped',
      ]} />
      <CodeBlock title="List an item" language="text">{
`> list on ebay: "Sony WH-1000XM5" at $289.99, new condition, free shipping

Creating inventory item SKU-FA-0042...
Creating offer for US marketplace...
Publishing... Done.
Live at: https://www.ebay.com/itm/123456789`
      }</CodeBlock>
    </>
  );
}

function PlatformWalmartSection() {
  return (
    <>
      <SectionHeading id="platform-walmart">Walmart</SectionHeading>
      <Paragraph>
        Walmart is supported for both sourcing (Affiliate API) and selling (Marketplace API).
        Authentication uses API key headers.
      </Paragraph>
      <SubHeading>Affiliate API</SubHeading>
      <ApiList items={[
        'Product Search -- keyword search across all Walmart categories',
        'Product Lookup -- get full details by Walmart item ID or UPC',
        'Taxonomy -- browse the Walmart category tree',
        'Trending -- discover trending products by category',
      ]} />
      <SubHeading>Marketplace API</SubHeading>
      <ApiList items={[
        'Item Management -- bulk feed-based listing creation and updates',
        'Price Management -- update pricing with competitive price matching',
        'Order Management -- retrieve and acknowledge orders, handle cancellations',
        'Inventory Management -- set and update stock quantities',
      ]} />
    </>
  );
}

function PlatformAliexpressSection() {
  return (
    <>
      <SectionHeading id="platform-aliexpress">AliExpress</SectionHeading>
      <Paragraph>
        AliExpress integration uses the Open Platform Affiliate API with HMAC-signed requests. Ideal
        for dropship sourcing where you need low-cost suppliers with direct shipping.
      </Paragraph>
      <ApiList items={[
        'aliexpress.affiliate.product.query -- search products with commission and shipping filters',
        'aliexpress.affiliate.productdetail.get -- full product details, variations, shipping options',
        'aliexpress.affiliate.order.get -- retrieve dropship order status and tracking',
        'aliexpress.affiliate.hotproduct.query -- trending/high-commission products',
      ]} />
      <CodeBlock title="Dropship sourcing" language="text">{
`> find aliexpress suppliers for "silicone phone case iphone 15"
  sort by orders, shipping to US under 15 days

Found 8 suppliers:
  1. TopCase Store  -- $1.23  (42K orders, 4.8 stars, 12-day ship)
  2. PhoneWorld     -- $1.47  (28K orders, 4.7 stars, 10-day ship)
  ...

> estimate margin selling #1 on amazon at $12.99
  Cost: $1.23 | Amazon fee: $5.18 | Shipping: $0 (FBM included)
  Net profit: $6.58  (50.6% margin)`
      }</CodeBlock>
      <Callout type="info">
        All AliExpress API requests are automatically signed with HMAC-SHA256 using your app secret.
        FlipGod manages timestamp generation and parameter sorting.
      </Callout>
    </>
  );
}

function PlatformOthersSection() {
  return (
    <>
      <SectionHeading id="platform-others">Others</SectionHeading>
      <Paragraph>
        FlipGod supports additional platforms for sourcing, price tracking, and logistics.
      </Paragraph>
      <SubHeading>Target</SubHeading>
      <Paragraph>
        Product search and clearance tracking via the Redsky API. Useful for retail arbitrage
        -- monitor in-store clearance prices and compare against online resale value.
      </Paragraph>
      <SubHeading>Best Buy</SubHeading>
      <Paragraph>
        Product catalog search and open-box deal monitoring through the Best Buy Products API.
        Includes real-time availability by store location for local pickup arbitrage.
      </Paragraph>
      <SubHeading>Faire</SubHeading>
      <Paragraph>
        Wholesale sourcing platform for unique and handmade products. Browse categories,
        check minimum order quantities, and compare wholesale-to-retail margins.
      </Paragraph>
      <SubHeading>Keepa</SubHeading>
      <Paragraph>
        Amazon price and sales rank history. FlipGod uses Keepa data to identify price drops,
        estimate sales velocity, and determine whether a product is worth sourcing long-term.
      </Paragraph>
      <SubHeading>EasyPost</SubHeading>
      <Paragraph>
        Shipping rate comparison across USPS, UPS, FedEx, and DHL. FlipGod uses EasyPost to
        calculate accurate shipping costs during margin analysis and to generate discounted labels
        when fulfilling orders.
      </Paragraph>
    </>
  );
}

function ArbitrageScannerSection() {
  return (
    <>
      <SectionHeading id="arbitrage-scanner">Arbitrage Scanner</SectionHeading>
      <Paragraph>
        The scanner compares prices across all configured platforms to find profitable arbitrage
        opportunities. It factors in fees, shipping, and estimated time-to-sell.
      </Paragraph>
      <CodeBlock title="Run a scan" language="text">{
`> scan arbitrage for "bluetooth speakers" category

Scanning Amazon, eBay, Walmart, AliExpress...
Found 14 opportunities (margin > 20%):

  #1  JBL Flip 6
      Buy: Walmart $89.00 | Sell: Amazon $129.95
      Fees: $19.49 | Shipping: $0 (FBA)
      Net: $21.46  (24.1% ROI)  Score: 87/100

  #2  Tribit StormBox
      Buy: AliExpress $18.40 | Sell: eBay $44.99
      Fees: $5.85 | Shipping: $3.20
      Net: $17.54  (95.3% ROI)  Score: 82/100
  ...`
      }</CodeBlock>
      <Paragraph>
        The <strong className="text-white">score</strong> combines margin percentage, sales velocity (BSR or sell-through rate),
        competition density, and historical price stability. Higher scores indicate more reliable flips.
      </Paragraph>
      <SubHeading>Scan Parameters</SubHeading>
      <ApiList items={[
        'Min margin threshold -- skip results below a profit floor (default: 15%)',
        'Platform filters -- include/exclude specific buy or sell platforms',
        'Category scope -- narrow to a product category or niche',
        'Condition filter -- new, used, refurbished, or open-box only',
        'Max investment -- cap the per-unit buy price',
      ]} />
    </>
  );
}

function ProductMatchingSection() {
  return (
    <>
      <SectionHeading id="product-matching">Product Matching</SectionHeading>
      <Paragraph>
        Cross-platform product matching is the backbone of arbitrage detection. FlipGod uses a
        multi-signal approach to link the same physical product across different marketplaces.
      </Paragraph>
      <SubHeading>Matching Signals</SubHeading>
      <ApiList items={[
        'UPC / EAN / GTIN -- barcode-level exact match (highest confidence)',
        'ASIN cross-reference -- Amazon ASIN mapped to eBay, Walmart, etc.',
        'MPN (Manufacturer Part Number) -- model number matching',
        'Title similarity -- fuzzy text matching with brand/model extraction',
        'Image hash -- perceptual hashing to match identical product photos',
      ]} />
      <CodeBlock title="Match a product" language="text">{
`> match "B09V3KXJPB" across all platforms

Amazon ASIN: B09V3KXJPB -- Apple AirPods Pro (2nd Gen)
  UPC: 194253397175
  eBay match: item #12345678  ($219.99, 847 sold/mo)
  Walmart match: item #4738291  ($229.00, in stock)
  AliExpress: no genuine match (counterfeit risk)`
      }</CodeBlock>
    </>
  );
}

function FeeCalculatorSection() {
  return (
    <>
      <SectionHeading id="fee-calculator">Fee Calculator</SectionHeading>
      <Paragraph>
        Accurate margin calculation requires understanding each platform's fee structure.
        FlipGod computes fees automatically during scans, but you can also run standalone
        calculations.
      </Paragraph>
      <CodeBlock title="Calculate fees" language="text">{
`> calculate fees: sell "headphones" on amazon at $49.99, category Electronics

  Referral fee (8%):    $4.00
  FBA fulfillment:      $5.40
  FBA storage (est):    $0.18
  Total fees:           $9.58
  Net after fees:       $40.41`
      }</CodeBlock>
      <SubHeading>Supported Fee Models</SubHeading>
      <ApiList items={[
        'Amazon -- referral fees by category (6-45%), FBA pick/pack/weight, storage, removal',
        'eBay -- final value fee (3-15% by category), promoted listing fee, payment processing',
        'Walmart -- referral fees by category (6-20%), WFS fulfillment fees',
        'Shipping -- EasyPost rate comparison for FBM/self-fulfilled orders',
      ]} />
    </>
  );
}

function ListingCreatorSection() {
  return (
    <>
      <SectionHeading id="listing-creator">Listing Creator</SectionHeading>
      <Paragraph>
        Create optimized listings on eBay and Amazon directly from the chat interface. FlipGod
        generates titles, descriptions, and bullet points using AI, then publishes via platform APIs.
      </Paragraph>
      <CodeBlock title="Create a listing" language="text">{
`> create ebay listing from ASIN B09V3KXJPB
  price $224.99, quantity 5, free shipping

Fetching product data from Amazon...
Generating optimized title (80 char limit)...
Generating description with key features...
  Title: "Apple AirPods Pro 2nd Gen - Active Noise Cancellation, USB-C - NEW SEALED"

Creating inventory item... done
Creating offer... done
Publishing... done

Live: https://www.ebay.com/itm/987654321`
      }</CodeBlock>
      <SubHeading>Template System</SubHeading>
      <Paragraph>
        Listing templates define reusable formats for titles, descriptions, shipping policies, and
        return policies. Create templates per category or niche to speed up bulk listing.
      </Paragraph>
      <CodeBlock title="Templates" language="text">{
`> create listing template "electronics-new"
  condition: new
  return policy: 30-day free returns
  shipping: free standard, $5.99 expedited
  description style: bullet points with specs

Template "electronics-new" saved.

> list 5 items from scan results using template "electronics-new"
Creating 5 listings... done (4 published, 1 needs review)`
      }</CodeBlock>
    </>
  );
}

function AutoScoutPipelineSection() {
  return (
    <>
      <SectionHeading id="auto-scout-pipeline">Auto-Scout Pipeline</SectionHeading>
      <Paragraph>
        Auto-Scout continuously scans for arbitrage opportunities based on saved configurations.
        New finds enter an approval queue so you stay in control.
      </Paragraph>
      <SubHeading>Pipeline Stages</SubHeading>
      <ApiList items={[
        'Config -- define categories, margin thresholds, buy/sell platforms, scan frequency',
        'Discovery -- automated scans run on your schedule (every 15 min, hourly, daily)',
        'Scoring -- each opportunity is scored by margin, velocity, competition, and risk',
        'Queue -- scored opportunities land in a review queue sorted by score',
        'Approval -- you approve, reject, or auto-approve above a score threshold',
        'Execution -- approved items are purchased and listed automatically',
      ]} />
      <CodeBlock title="Configure auto-scout" language="text">{
`> create auto-scout config
  name: "Electronics Under $50"
  buy platforms: walmart, aliexpress
  sell platform: amazon
  categories: Electronics, Cell Phones & Accessories
  min margin: 25%
  max buy price: $50
  scan frequency: every 30 minutes
  auto-approve above score: 90

Config "Electronics Under $50" created.
Next scan in 30 minutes.`
      }</CodeBlock>
      <CodeBlock title="Review queue" language="text">{
`> show scout queue

3 items pending approval:
  #1  Score 94 -- Anker 20W Charger  (Buy: $8.40 / Sell: $18.99 / Margin: 42%)
  #2  Score 88 -- USB-C Hub 7-in-1   (Buy: $12.30 / Sell: $29.99 / Margin: 38%)
  #3  Score 72 -- Phone Stand         (Buy: $2.10 / Sell: $11.99 / Margin: 55%)

> approve #1 and #2
Purchased Anker charger (qty 10)... listed on Amazon.
Purchased USB-C Hub (qty 5)... listed on Amazon.`
      }</CodeBlock>
    </>
  );
}

function SmartRepricingSection() {
  return (
    <>
      <SectionHeading id="smart-repricing">Smart Repricing</SectionHeading>
      <Paragraph>
        Smart Repricing monitors competitor prices and adjusts your listings to stay competitive
        while protecting margins.
      </Paragraph>
      <SubHeading>Repricing Strategies</SubHeading>
      <ApiList items={[
        'Match lowest -- always match the lowest competing price',
        'Beat by amount -- undercut the lowest price by a fixed dollar or percentage',
        'Price ceiling / floor -- set hard upper and lower bounds',
        'Rule-based -- define conditional rules (e.g. if BSR < 500 then price aggressively)',
        'Velocity-based -- raise price when selling fast, lower when stale',
      ]} />
      <CodeBlock title="Configure repricing" language="text">{
`> set repricing for SKU-FA-0042
  strategy: beat lowest by $0.50
  floor: $18.99 (my break-even + 15%)
  ceiling: $34.99
  check frequency: every 2 hours

Repricing rule saved.
Current price: $24.99 | Lowest competitor: $25.49
No change needed -- already below competitor.`
      }</CodeBlock>
    </>
  );
}

function FulfillmentChainSection() {
  return (
    <>
      <SectionHeading id="fulfillment-chain">Fulfillment Chain</SectionHeading>
      <Paragraph>
        The fulfillment chain automates the end-to-end order lifecycle through a 12-state pipeline
        from purchase to delivery confirmation.
      </Paragraph>
      <SubHeading>Pipeline States</SubHeading>
      <div className="my-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {[
          'ORDER_RECEIVED',
          'PAYMENT_VERIFIED',
          'SOURCING',
          'PURCHASED',
          'SUPPLIER_SHIPPED',
          'IN_TRANSIT',
          'RECEIVED_WAREHOUSE',
          'QUALITY_CHECK',
          'PACKED',
          'SHIPPED_TO_BUYER',
          'DELIVERED',
          'COMPLETED',
        ].map((state, i) => (
          <div key={state} className="flex items-center gap-2 px-3 py-2 rounded bg-slate-800 border border-slate-700">
            <span className="text-xs font-bold text-emerald-400 w-5">{i + 1}</span>
            <span className="text-xs text-slate-300 font-mono">{state}</span>
          </div>
        ))}
      </div>
      <Paragraph>
        When a sale triggers, FlipGod can auto-purchase from the source supplier, track the
        inbound shipment, and push tracking info to the selling platform once shipped.
      </Paragraph>
      <CodeBlock title="Fulfillment flow" language="text">{
`> show order FA-1042 fulfillment

Order FA-1042: JBL Flip 6
  State: SHIPPED_TO_BUYER (10 of 12)
  Bought from: Walmart ($89.00) on Jan 15
  Received at warehouse: Jan 18
  Quality check: PASSED
  Shipped to buyer via USPS Priority: Jan 19
  Tracking: 9400111899223847650321
  ETA: Jan 22`
      }</CodeBlock>
    </>
  );
}

function PriceIntelligenceSection() {
  return (
    <>
      <SectionHeading id="price-intelligence">Price Intelligence</SectionHeading>
      <Paragraph>
        Track price history, detect drops and spikes, and generate buy/sell signals based on
        historical trends.
      </Paragraph>
      <SubHeading>Capabilities</SubHeading>
      <ApiList items={[
        'Price history charts -- 30/60/90/365-day price trends per ASIN or UPC',
        'Drop alerts -- notify when a product drops below your target buy price',
        'Spike detection -- identify sudden price increases (supply shortage opportunities)',
        'Seasonal trends -- discover cyclical patterns for timing purchases',
        'Buy/sell signals -- algorithmic recommendation based on price position vs. historical range',
      ]} />
      <CodeBlock title="Price tracking" language="text">{
`> track price for ASIN B09V3KXJPB
  alert me when below $180

Tracking Apple AirPods Pro 2nd Gen.
  Current: $199.99
  30-day low: $189.00
  90-day low: $169.99 (Prime Day)
  Alert set: notify when price < $180.00`
      }</CodeBlock>
    </>
  );
}

function DemandScoringSection() {
  return (
    <>
      <SectionHeading id="demand-scoring">Demand Scoring</SectionHeading>
      <Paragraph>
        The demand scoring model combines 6 signals to estimate how quickly a product will sell and
        at what price stability.
      </Paragraph>
      <SubHeading>Scoring Signals</SubHeading>
      <ApiList items={[
        'Sales velocity -- estimated units sold per day (from BSR or sell-through rate)',
        'Price stability -- standard deviation of price over 30 days (lower = better)',
        'Review momentum -- rate of new reviews (indicates growing demand)',
        'Competitor count -- number of active sellers (fewer = less price pressure)',
        'Search volume -- keyword search trend data',
        'Seasonality index -- current position in seasonal demand cycle',
      ]} />
      <CodeBlock title="Demand analysis" language="text">{
`> analyze demand for "stanley tumbler 40oz"

Demand Score: 91/100 (Very High)
  Sales velocity:    ~320 units/day (BSR #48 in Kitchen)
  Price stability:   High (std dev $1.20 over 30 days)
  Review momentum:   +847 reviews this month
  Competitors:       23 active sellers
  Search volume:     Trending up (+18% MoM)
  Seasonality:       Neutral (no strong seasonal pattern)

Recommendation: STRONG BUY if margin > 20%`
      }</CodeBlock>
    </>
  );
}

function PnlReportsSection() {
  return (
    <>
      <SectionHeading id="pnl-reports">P&L Reports</SectionHeading>
      <Paragraph>
        Track profitability at the per-SKU level with full cost accounting including COGS, platform
        fees, shipping, and returns.
      </Paragraph>
      <CodeBlock title="P&L summary" language="text">{
`> show pnl report this month

January 2026 P&L Summary
  Revenue:        $12,847.00
  COGS:           -$7,209.40
  Platform fees:  -$1,926.85
  Shipping:       -$843.20
  Returns:        -$412.00
  ─────────────────────────
  Net profit:     $2,455.55  (19.1% margin)

  Top performer: JBL Flip 6 (47 sold, $1,008 profit)
  Worst performer: Phone Cases (12 sold, -$18 loss)`
      }</CodeBlock>
      <SubHeading>Export Formats</SubHeading>
      <ApiList items={[
        'CSV -- per-transaction detail for spreadsheet analysis',
        'PDF -- formatted monthly statement',
        'JSON -- machine-readable for custom dashboards',
        'Tax summary -- categorized by state for sales tax filing',
      ]} />
    </>
  );
}

function RestrictionCheckerSection() {
  return (
    <>
      <SectionHeading id="restriction-checker">Restriction Checker</SectionHeading>
      <Paragraph>
        Before sourcing a product, check whether it is restricted on your target selling platform.
        FlipGod checks brand gating, category restrictions, hazmat classification, and IP concerns.
      </Paragraph>
      <CodeBlock title="Check restrictions" language="text">{
`> check restrictions for "Nike Air Max 90" on amazon

Restriction Report:
  Brand: Nike -- GATED (requires brand approval or invoices)
  Category: Clothing & Shoes -- OPEN (no category gate)
  Hazmat: No
  IP complaints: 2 recent reports on this ASIN

  Verdict: NOT RECOMMENDED unless you have Nike brand approval.`
      }</CodeBlock>
      <ApiList items={[
        'Brand gating -- checks if the brand requires approval to sell',
        'Category restrictions -- identifies categories that need ungating',
        'Hazmat / dangerous goods -- flags items needing special handling',
        'IP complaint history -- surfaces ASINs with recent takedown activity',
      ]} />
    </>
  );
}

function MultiChannelSyncSection() {
  return (
    <>
      <SectionHeading id="multi-channel-sync">Multi-Channel Sync</SectionHeading>
      <Paragraph>
        When selling the same product on multiple platforms, inventory sync prevents overselling.
        FlipGod maintains a central inventory count and pushes updates to all connected channels.
      </Paragraph>
      <ApiList items={[
        'Central inventory ledger -- single source of truth for stock quantities',
        'Real-time sync -- inventory updates propagate within 60 seconds',
        'Buffer stock -- reserve a safety buffer per platform to prevent stockouts',
        'Allocation rules -- prioritize platforms by margin or velocity',
        'Oversell protection -- automatic listing pause when stock hits zero',
      ]} />
      <CodeBlock title="Sync setup" language="text">{
`> sync inventory for SKU "JBL-FLIP6-BLK"
  total stock: 25
  buffer: 2 per platform
  allocate: amazon 15, ebay 8

Inventory synced:
  Amazon: 15 available (2 buffer)
  eBay: 8 available (2 buffer)
  On sale on eBay... quantity decremented to 7.
  Amazon updated: 14 available.`
      }</CodeBlock>
    </>
  );
}

function SupplierCrmSection() {
  return (
    <>
      <SectionHeading id="supplier-crm">Supplier CRM</SectionHeading>
      <Paragraph>
        Track your suppliers, their performance, lead times, and reorder points. FlipGod alerts
        you when stock is running low and suggests reorder quantities based on sales velocity.
      </Paragraph>
      <ApiList items={[
        'Supplier profiles -- contact info, payment terms, minimum order quantities',
        'Performance tracking -- on-time rate, defect rate, response time',
        'Reorder alerts -- automated notifications when stock hits reorder point',
        'Cost history -- track price changes over time per supplier',
        'Multi-supplier -- compare pricing and reliability across suppliers for the same product',
      ]} />
      <CodeBlock title="Supplier management" language="text">{
`> show supplier "TopCase Store" performance

TopCase Store (AliExpress)
  Orders placed: 47
  On-time delivery: 94%
  Defect rate: 1.2%
  Avg lead time: 11 days
  Response time: < 4 hours
  Rating: A (Preferred)

  Products sourced: 8 SKUs
  Total spend: $2,340.00`
      }</CodeBlock>
    </>
  );
}

function WebDashboardSection() {
  return (
    <>
      <SectionHeading id="web-dashboard">Web Dashboard</SectionHeading>
      <Paragraph>
        FlipGod includes a built-in web dashboard at <InlineCode>/dashboard</InlineCode> for
        real-time monitoring. No additional setup required -- it starts with the agent.
      </Paragraph>
      <ApiList items={[
        'Live P&L -- real-time profit tracking with charts',
        'Active listings -- status, views, and sales per listing',
        'Scout queue -- pending arbitrage opportunities',
        'Order pipeline -- fulfillment state for all active orders',
        'Inventory levels -- stock across all platforms with sync status',
        'Price alerts -- triggered alerts and watchlist',
      ]} />
      <CodeBlock title="Access" language="text">{
`> open dashboard

Dashboard running at http://localhost:3000/dashboard
  - P&L: $2,455 this month (+19.1%)
  - Active listings: 142
  - Pending orders: 7
  - Scout queue: 3 items awaiting approval`
      }</CodeBlock>
    </>
  );
}

function ToolListSection() {
  return (
    <>
      <SectionHeading id="tool-list">Tool List</SectionHeading>
      <Paragraph>
        FlipGod ships with 435+ tools organized by category. The AI agent selects the right tool
        automatically based on your natural language request.
      </Paragraph>
      <div className="my-4 overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800">
              <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Category</th>
              <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Count</th>
              <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Examples</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Amazon', '62', 'search_amazon, get_item_details, list_product, update_price'],
              ['eBay', '48', 'search_ebay, create_listing, get_orders, upload_tracking'],
              ['Walmart', '35', 'search_walmart, bulk_upload, manage_inventory'],
              ['AliExpress', '28', 'search_aliexpress, get_product, place_order, track_shipment'],
              ['Arbitrage', '40', 'scan_arbitrage, calculate_margin, score_opportunity'],
              ['Pricing', '32', 'get_price_history, set_reprice_rule, calculate_fees'],
              ['Inventory', '25', 'sync_inventory, check_stock, set_buffer'],
              ['Fulfillment', '30', 'create_shipment, get_rates, push_tracking'],
              ['Analytics', '45', 'pnl_report, demand_score, sales_velocity, trend_analysis'],
              ['Sourcing', '38', 'find_suppliers, compare_costs, check_restrictions'],
              ['Keepa', '12', 'price_history, sales_rank, buy_box_stats'],
              ['Shipping', '18', 'compare_rates, create_label, validate_address'],
              ['Utilities', '22', 'upc_lookup, asin_to_upc, currency_convert'],
            ].map(([cat, count, examples], i) => (
              <tr key={cat} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/50'}>
                <td className="px-4 py-2 text-white font-medium">{cat}</td>
                <td className="px-4 py-2 text-emerald-400 font-mono">{count}</td>
                <td className="px-4 py-2 text-slate-400 font-mono text-xs">{examples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout type="info">
        You do not need to memorize tool names. Just describe what you want in plain English and
        FlipGod will select the appropriate tool. Type <InlineCode>list tools</InlineCode> to
        see the full catalog.
      </Callout>
    </>
  );
}

function RestApiSection() {
  return (
    <>
      <SectionHeading id="rest-api">REST API</SectionHeading>
      <Paragraph>
        The dashboard exposes a REST API at <InlineCode>/dashboard/api</InlineCode> for programmatic
        access. All endpoints return JSON.
      </Paragraph>
      <div className="my-4 overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800">
              <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Method</th>
              <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Endpoint</th>
              <th className="text-left px-4 py-2.5 text-slate-300 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['GET', '/dashboard/api/pnl', 'Profit & loss summary (daily, weekly, monthly)'],
              ['GET', '/dashboard/api/listings', 'Active listings with status and metrics'],
              ['GET', '/dashboard/api/orders', 'Order list with fulfillment state'],
              ['GET', '/dashboard/api/inventory', 'Inventory levels across all platforms'],
              ['GET', '/dashboard/api/scout/queue', 'Pending arbitrage opportunities'],
              ['POST', '/dashboard/api/scout/approve/:id', 'Approve a scout opportunity'],
              ['POST', '/dashboard/api/scout/reject/:id', 'Reject a scout opportunity'],
              ['GET', '/dashboard/api/repricing', 'Active repricing rules and recent changes'],
              ['GET', '/dashboard/api/suppliers', 'Supplier list with performance metrics'],
              ['GET', '/dashboard/api/alerts', 'Price alerts and notifications'],
              ['POST', '/dashboard/api/scan', 'Trigger an on-demand arbitrage scan'],
              ['GET', '/dashboard/api/health', 'Service health and API connectivity status'],
            ].map(([method, endpoint, desc], i) => (
              <tr key={endpoint} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/50'}>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    method === 'GET' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {method}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-sm text-slate-300">{endpoint}</td>
                <td className="px-4 py-2 text-slate-400">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock title="Example API call" language="bash">{
`curl http://localhost:3000/dashboard/api/pnl?period=monthly

{
  "period": "2026-01",
  "revenue": 12847.00,
  "cogs": 7209.40,
  "fees": 1926.85,
  "shipping": 843.20,
  "returns": 412.00,
  "net_profit": 2455.55,
  "margin_pct": 19.1
}`
      }</CodeBlock>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section router
// ---------------------------------------------------------------------------

const SECTION_COMPONENTS = {
  'quick-start': QuickStartSection,
  'configuration': ConfigurationSection,
  'setting-up-credentials': SettingUpCredentialsSection,
  'platform-amazon': PlatformAmazonSection,
  'platform-ebay': PlatformEbaySection,
  'platform-walmart': PlatformWalmartSection,
  'platform-aliexpress': PlatformAliexpressSection,
  'platform-others': PlatformOthersSection,
  'arbitrage-scanner': ArbitrageScannerSection,
  'product-matching': ProductMatchingSection,
  'fee-calculator': FeeCalculatorSection,
  'listing-creator': ListingCreatorSection,
  'auto-scout-pipeline': AutoScoutPipelineSection,
  'smart-repricing': SmartRepricingSection,
  'fulfillment-chain': FulfillmentChainSection,
  'price-intelligence': PriceIntelligenceSection,
  'demand-scoring': DemandScoringSection,
  'pnl-reports': PnlReportsSection,
  'restriction-checker': RestrictionCheckerSection,
  'multi-channel-sync': MultiChannelSyncSection,
  'supplier-crm': SupplierCrmSection,
  'web-dashboard': WebDashboardSection,
  'tool-list': ToolListSection,
  'rest-api': RestApiSection,
};

// ---------------------------------------------------------------------------
// Main DocsPage component
// ---------------------------------------------------------------------------

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('quick-start');
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    NAV_SECTIONS.forEach((s) => { initial[s.id] = true; });
    return initial;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  // Close sidebar on escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleGroup = (id) => {
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNavClick = (sectionId) => {
    setActiveSection(sectionId);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const ActiveComponent = SECTION_COMPONENTS[activeSection];

  // Find current position for prev/next
  const allSections = NAV_SECTIONS.flatMap((g) => g.children.map((c) => c.id));
  const currentIndex = allSections.indexOf(activeSection);
  const prevSection = currentIndex > 0 ? allSections[currentIndex - 1] : null;
  const nextSection = currentIndex < allSections.length - 1 ? allSections[currentIndex + 1] : null;

  const getSectionLabel = (id) => {
    for (const group of NAV_SECTIONS) {
      for (const child of group.children) {
        if (child.id === id) return child.label;
      }
    }
    return id;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-800 text-slate-400"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-white hover:text-emerald-400 transition-colors"
            >
              <ArrowLeft size={16} />
              <span className="font-bold text-lg">FlipGod</span>
            </button>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <span className="text-slate-400 text-sm hidden sm:inline">Documentation</span>
          </div>
          <a
            href="https://github.com/alsk1992/Flip-God"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            GitHub
            <ExternalLink size={14} />
          </a>
        </div>
      </header>

      <div className="flex">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed top-14 left-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800
            overflow-y-auto z-40 transition-transform duration-200
            lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0 lg:block
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <nav className="p-4 space-y-1">
            {NAV_SECTIONS.map((group) => {
              const Icon = group.icon;
              const isExpanded = expandedGroups[group.id];
              const isGroupActive = group.children.some((c) => c.id === activeSection);

              return (
                <div key={group.id}>
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium
                      transition-colors
                      ${isGroupActive ? 'text-emerald-400' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}
                    `}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronRight
                      size={14}
                      className={`flex-shrink-0 text-slate-500 transition-transform duration-150 ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="ml-4 pl-4 border-l border-slate-800 mt-1 mb-2 space-y-0.5">
                      {group.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => handleNavClick(child.id)}
                          className={`
                            w-full text-left px-3 py-1.5 rounded text-sm transition-colors
                            ${activeSection === child.id
                              ? 'bg-emerald-500/10 text-emerald-400 font-medium'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                            }
                          `}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="max-w-4xl mx-auto px-6 py-8 lg:px-12">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
              <span>Docs</span>
              <ChevronRight size={12} />
              <span>
                {NAV_SECTIONS.find((g) => g.children.some((c) => c.id === activeSection))?.label}
              </span>
              <ChevronRight size={12} />
              <span className="text-slate-300">{getSectionLabel(activeSection)}</span>
            </div>

            {/* Active section content */}
            {ActiveComponent && <ActiveComponent />}

            {/* Prev / Next navigation */}
            <div className="mt-16 pt-8 border-t border-slate-800 flex items-center justify-between">
              {prevSection ? (
                <button
                  onClick={() => handleNavClick(prevSection)}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400 transition-colors"
                >
                  <ArrowLeft size={16} />
                  <span>{getSectionLabel(prevSection)}</span>
                </button>
              ) : (
                <div />
              )}
              {nextSection ? (
                <button
                  onClick={() => handleNavClick(nextSection)}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400 transition-colors"
                >
                  <span>{getSectionLabel(nextSection)}</span>
                  <ChevronRight size={16} />
                </button>
              ) : (
                <div />
              )}
            </div>

            {/* Footer */}
            <footer className="mt-12 py-8 border-t border-slate-800 text-center text-sm text-slate-600">
              FlipGod Documentation -- AI-powered e-commerce arbitrage.
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
