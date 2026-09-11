# Retail Rocket ERP

You are an expert senior software architect, product designer, and full-stack engineer. Your task is to design and build a fully functional, production-ready desktop billing and ERP system similar to leading retail ERP software like Marg ERP.

The application must be built for desktop use (Windows-first, scalable to web/cloud) using Lovable Cloud infrastructure.

Prioritize:

 Performance

 Clean architecture

 Offline-first capability with cloud sync

 Exceptional UI/UX for fast billing counters

 Real-world retail usability

CORE PRODUCT GOAL

Build a complete Billing + Inventory + Accounting + POS ERP system for retail and wholesale businesses with:

 Fast billing system (keyboard-first)

 GST-compliant invoicing (India-ready)

 Inventory management in real time

 Barcode support

 Thermal printer support (58mm / 80mm)

 Multi-store ERP capability

MODULES

Billing / POS

 Fast invoice creation

 Barcode scanning

 Product search autocomplete

 Multiple price levels (retail/wholesale/MRP)

 GST auto calculation

 Discount (item + bill level)

 Hold/recall bill

 Split payments (cash/card/UPI)

 Returns/refunds

 Customer selection + history

Inventory

 Product management (name, SKU, barcode, category)

 Stock in/out tracking

 Purchase entry

 Supplier management

 Low stock alerts

 Stock adjustments

Purchase

 Purchase invoice entry

 Supplier credit tracking

 Purchase return

 GST input tracking

Customers & Sales

 Customer database

 Credit/debit tracking

 Outstanding payments

 Sales history

Accounting

 Cash ledger

 Profit & loss

 Daily sales report

 Expenses

 Receivables/payables

Reports

 Daily sales report

 Product sales report

 Stock valuation

 GST reports

 Export PDF/Excel

Printer & Hardware

 ESC/POS thermal printer support

 A4 invoice printing

 Cash drawer support

 Barcode scanner plug-and-play

 Custom invoice templates

 QR code on invoice

User Roles

 Admin / Manager / Cashier roles

 Permission-based access

 Activity logs

Cloud & Sync

 Offline-first database

 Auto sync with cloud

 Multi-device sync

 Secure encrypted backup

UI/UX REQUIREMENTS

 Ultra-fast billing screen

 Keyboard-first navigation

 Minimal clicks

 Clean modern ERP dashboard

 Dark/light mode

 Sidebar navigation

Billing screen layout:

 Left: product search/categories

 Center: invoice cart

 Right: payment summary

 Bottom: quick actions (Save/Print/Hold/Discount)

PERFORMANCE

 Must support 100,000+ products

 Instant search (<100ms feel)

 No UI lag

 Optimized queries

 Lazy loading where needed

DATABASE

Design schema for:

 Products

 Categories

 Sales

 Purchases

 Customers

 Suppliers

 Payments

 Stock ledger

 Users & roles

Ensure audit logs and data integrity.

PRINTING

 ESC/POS compatible printing

 Custom receipt templates

 Logo support

 Invoice numbering system

 Multi-printer selection

SECURITY

 Role-based access control

 Encrypted sensitive data

 Secure login system

 Full activity logging

FINAL OUTPUT

Generate:

 Full system architecture

 UI design structure

 Database schema

 Complete frontend + backend implementation

 Printer integration system

 Production-ready codebase

 Scalable folder structure

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/139249e3-8359-4237-a7a3-971e03417ee7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
