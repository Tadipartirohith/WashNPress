// Shared framer-motion variants for the admin portal, matching the entrance/stagger
// pattern established in app/app/page.tsx (the resident portal) so every staff
// screen feels like the same product.
export const listV = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
export const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };
export const fade = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };
