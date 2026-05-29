// Default theme — retuned to Alphix's dark palette so the widget reads as Alphix.
// Source values (from app/globals.css):
//   --swap-background:           #131313
//   --token-selector-background: #1b1b1b
//   --surface-bg:                #181818  (input fields / interactive surfaces)
//   --container-secondary-bg:    #161616
//   --swap-border / --sidebar-border: #323232
//   --brand-primary (Alphix Orange): #f45502
// Border radius mirrors Alphix's rounded-lg = 8px.
export const defaultTheme = {
  text: '#FFFFFF',
  subText: '#A6A6A6',
  primary: '#131313',     // outer card (Wrapper bg)
  dialog: '#1B1B1B',      // modal background (token selector, settings)
  secondary: '#181818',   // input panels (Sell/Buy) + Detail card — Alphix surface-bg
  interactive: '#1B1B1B', // chip / select-token-btn bg / hover surface
  stroke: '#323232',      // borders
  accent: '#F45502',      // Alphix Orange — primary CTA + focus
  success: '#21C982',
  warning: '#FFB020',
  error: '#FF537B',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: '8px',  // rounded-lg in Alphix
  buttonRadius: '6px',  // rounded-md for percentage buttons etc.
  boxShadow: 'none',
};
export type Theme = typeof defaultTheme;
