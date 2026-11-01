import { useMemo, useState } from "react";
import { create } from "zustand";
import { ExternalLink, Minus, Plus, ShoppingBag, Star, Trash2, X } from "lucide-react";
import { buildRoomCart, formatInr, type FurnitureObject, type Scene } from "@reality-builder/shared";
import { catalogById, type CatalogItem } from "../../data/catalog";
import { marketplaceLinks, realOptionsFor, realProductFor } from "../../data/products";
import { useWorkspaceStore } from "../../store/workspace";
import { Section } from "./fields";

export const useShop = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Every library object gets its real product (objects saved before the shopping layer, or with old estimates). */
export function withCatalogProducts(scene: Scene): Scene {
  return { ...scene, furniture: scene.furniture.map((item) => {
    const entry = catalogById(item.catalogItemId);
    if (!entry) return item.product && !item.product.sample ? item : { ...item, product: undefined };
    const product = realProductFor(entry, item.color);
    if (product) return { ...item, product };
    const { product: _old, ...rest } = item;
    return rest;
  }) };
}

const STALE_DAYS = 30;
const daysSince = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : Infinity);

/** Real product card: photo, price, size, links. Shared by the inspector and the dashboard library. */
export function ProductCard({ entry, colour, compact }: { entry: CatalogItem; colour?: string; compact?: boolean }) {
  const product = realProductFor(entry, colour);
  const options = realOptionsFor(entry).filter((option) => option.productId !== product?.productId).slice(0, 4);
  return (
    <div className="shop-product">
      {product ? (
        <>
          {product.thumbnailUrl ? <a className="shop-photo" href={product.productUrl} target="_blank" rel="noopener noreferrer"><img src={product.thumbnailUrl} alt={product.productName} referrerPolicy="no-referrer" /></a> : null}
          <strong>{product.productName}</strong>
          <span className="shop-price">{formatInr(product.price)}</span>
          <span className="shop-meta">{[product.measure, product.material, product.rating ? `★ ${product.rating}` : ""].filter(Boolean).join(" · ")}</span>
          <span className="shop-meta">Price on IKEA India, checked {product.priceCheckedAt}{daysSince(product.priceCheckedAt) > STALE_DAYS ? " (may have changed)" : ""}</span>
          <a className="primary-button shop-view" href={product.productUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> View on IKEA India</a>
        </>
      ) : <span className="shop-meta">Not sold by IKEA India. Compare on:</span>}
      <div className="shop-links">
        {marketplaceLinks(entry.name).map((link) => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} /> {link.name}</a>)}
      </div>
      {!compact && options.length ? (
        <div className="shop-alts">
          <span className="shop-alts-title">Other matching products</span>
          {options.map((option) => (
            <a key={option.productId} className="shop-alt" href={option.productUrl} target="_blank" rel="noopener noreferrer">
              {option.thumbnailUrl ? <img src={option.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span />}
              <span><strong>{option.productName}</strong><small>{[option.material, option.measure].filter(Boolean).join(" · ")}</small></span>
              <b>{formatInr(option.price)}</b>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Inspector block: the real product for the selected object, following its current colour. */
export function ProductSection({ item }: { item: FurnitureObject }) {
  const entry = catalogById(item.catalogItemId);
  if (!entry || entry.opening || entry.group === "basic") return null;
  const product = realProductFor(entry, item.color);
  return (
    <Section title="Real product" collapsible aside={product ? <span className="shop-badge shop-badge--real">IKEA India</span> : null}>
      <ProductCard entry={entry} colour={item.color} />
    </Section>
  );
}

/** "Shop this room": cart built from the scene, grouped by retailer, with hand-off to each retailer. */
export function ShopDrawer() {
  const open = useShop((state) => state.open);
  const scene = useWorkspaceStore((state) => state.scene);
  const activeRoomId = useWorkspaceStore((state) => state.activeRoomId);
  const [wholeHouse, setWholeHouse] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const cart = useMemo(() => buildRoomCart(withCatalogProducts(scene), wholeHouse ? undefined : activeRoomId ?? undefined), [scene, wholeHouse, activeRoomId]);
  if (!open) return null;
  const close = () => useShop.getState().setOpen(false);
  const qty = (key: string, fallback: number) => quantities[key] ?? fallback;
  const groups = cart.groups.map((group) => {
    const lines = group.lines.filter((line) => !removed.includes(line.productId)).map((line) => ({ ...line, quantity: qty(line.productId, line.quantity) }));
    return { ...group, lines, subtotal: lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0) };
  }).filter((group) => group.lines.length);
  const total = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const unmatched = withCatalogProducts(scene).furniture.filter((item) => !item.product && catalogById(item.catalogItemId) && (wholeHouse || item.roomId === activeRoomId));
  const select = (id?: string) => { if (id) { useWorkspaceStore.getState().selectEntity(id); close(); } };
  return (
    <div className="shop-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <aside className="shop-drawer" role="dialog" aria-label="Shop this room">
        <header>
          <h2><ShoppingBag size={18} /> Shop this {wholeHouse ? "design" : "room"}</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="segmented shop-scope">
          <button type="button" className={wholeHouse ? "active" : ""} onClick={() => setWholeHouse(true)}>Whole design</button>
          <button type="button" className={!wholeHouse ? "active" : ""} onClick={() => setWholeHouse(false)}>Current room</button>
        </div>
        <div className="shop-body">
          {groups.length === 0 ? (
            <div className="shop-empty">
              <strong>Your cart is empty</strong>
              <p>Add furniture from the library. Each piece comes with its real product and price.</p>
            </div>
          ) : groups.map((group) => {
            const stale = group.lines.some((line) => line.product.availability === "out-of-stock" || daysSince(line.product.priceCheckedAt) > STALE_DAYS);
            return (
              <section key={group.retailerId} className="shop-group">
                <h3>{group.retailerName}<span>{formatInr(group.subtotal)}</span></h3>
                {group.lines.map((line) => (
                  <div key={line.productId} className="shop-line">
                    {line.product.thumbnailUrl ? <img className="shop-thumb" src={line.product.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span />}
                    <button type="button" className="shop-line-name" onClick={() => select(line.objectIds[0])} title="Show in the design">
                      <strong>{line.product.productName}</strong>
                      <small>{formatInr(line.product.price)} each</small>
                    </button>
                    <div className="shop-qty">
                      <button type="button" aria-label="Fewer" onClick={() => setQuantities({ ...quantities, [line.productId]: Math.max(1, line.quantity - 1) })}><Minus size={12} /></button>
                      <span>{line.quantity}</span>
                      <button type="button" aria-label="More" onClick={() => setQuantities({ ...quantities, [line.productId]: Math.min(99, line.quantity + 1) })}><Plus size={12} /></button>
                    </div>
                    <span className="shop-line-total">{formatInr(line.product.price * line.quantity)}</span>
                    <button type="button" className="icon-button" aria-label="Remove from cart" onClick={() => setRemoved([...removed, line.productId])}><Trash2 size={14} /></button>
                    {line.product.productUrl ? <a className="icon-button" href={line.product.productUrl} target="_blank" rel="noopener noreferrer" aria-label="Open product page"><ExternalLink size={14} /></a> : null}
                  </div>
                ))}
                {stale ? <p className="shop-warn">Some prices were checked over {STALE_DAYS} days ago and may have changed.</p> : null}
                <a className="primary-button shop-checkout" href={group.lines[0]!.product.productUrl} target="_blank" rel="noopener noreferrer" onClick={() => group.lines.slice(1).forEach((line) => line.product.productUrl && window.open(line.product.productUrl, "_blank", "noopener"))}><ShoppingBag size={14} /> Checkout on {group.retailerName} ({group.lines.length} product{group.lines.length === 1 ? "" : "s"})</a>
              </section>
            );
          })}
          {unmatched.length ? (
            <section className="shop-group shop-group--sample">
              <h3>Compare on Amazon.in & Flipkart<span>{unmatched.length}</span></h3>
              {unmatched.map((item) => (
                <div key={item.id} className="shop-line shop-line--compare">
                  <button type="button" className="shop-line-name" onClick={() => select(item.id)}><strong>{item.name}</strong></button>
                  <span className="shop-links">{marketplaceLinks(item.name).map((link) => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer">{link.name}</a>)}</span>
                </div>
              ))}
            </section>
          ) : null}
        </div>
        <footer className="shop-summary">
          <div><span>Items subtotal ({groups.reduce((sum, group) => sum + group.lines.reduce((n, line) => n + line.quantity, 0), 0)})</span><b>{formatInr(total)}</b></div>
          <div className="shop-muted"><span>Shipping, taxes, discounts</span><span>shown by each retailer at checkout</span></div>
          <div className="shop-total"><span>Estimated total</span><b>{formatInr(total)}</b></div>
          <p className="shop-note">Checkout continues on {groups.map((group) => group.retailerName).join(", ") || "the retailer's site"}.</p>
        </footer>
      </aside>
    </div>
  );
}
