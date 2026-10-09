import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { TopBar } from '../../components/ui';

/**
 * "How to use Slay" – a short, plain guide for someone using an app like this for the first time.
 * Button names here match the app's own labels exactly; update both together.
 */
export function GuidePage() {
  return (
    <>
      <TopBar title="How to use Slay" back="/more" />
      <main className="page stack guide" style={{ paddingTop: 12 }}>
        <p className="small muted">Five minutes to read. Tap a topic to open it. You can come back here any time from More → How to use Slay.</p>

        <Topic title="Getting around" open>
          <p>The bar at the bottom takes you everywhere:</p>
          <ul>
            <li>
              <b>Home</b> – today’s sales, money still to collect, orders to send. <b>Sales for any dates</b> adds up any period, all the way back to your first order.
            </li>
            <li>
              <b>Orders</b> – every order, newest first.
            </li>
            <li>
              <b>+</b> (the big pink button) – take a new order.
            </li>
            <li>
              <b>Stock</b> – everything you sell and how many are left.
            </li>
            <li>
              <b>More</b> – supplier bills, customers, team, settings and this guide.
            </li>
          </ul>
          <p>Everything you save shows up straight away on the phones of everyone in your team, and theirs on yours.</p>
        </Topic>

        <Topic title="Take an order">
          <ol>
            <li>
              Tap the pink <b>+</b>.
            </li>
            <li>
              Under <b>Order came from</b>, tap TikTok, Facebook, Instagram or WhatsApp.
            </li>
            <li>
              Type the customer’s <b>Phone</b> and <b>Name</b>. If she has ordered before, her past orders appear – tap <b>History</b> to see them.
            </li>
            <li>
              Tap <b>Add item</b>, choose the product, then the colour.
            </li>
            <li>
              Set the quantity with <b>−</b> and <b>+</b>, pick the <b>Size</b>, and check the <b>Price each</b>.
            </li>
            <li>
              Under <b>Payment</b>, tap <b>Paid in full</b>, <b>Partial</b> (then type how much she paid) or <b>COD</b> (pays on delivery).
            </li>
            <li>
              Tap <b>Save order</b>. Slay gives it a number like SLAY-2026-0015 and takes the pieces out of stock.
            </li>
          </ol>
          <Tip>
            Two of the same kurta in different sizes? Set the quantity to 2, tap <b>Different size for each piece</b> and pick a size for each one.
          </Tip>
          <Tip>
            If Slay says <i>“Only 1 left”</i>, there isn’t enough in stock – lower the quantity, or add the new pieces under Stock first.
          </Tip>
        </Topic>

        <Topic title="Use your voice instead of typing">
          <p>
            Every box has a small pink <b>mic</b> button next to its name. Tap it, say <b>just that one thing</b>, and Slay fills in only that box.
          </p>
          <ol>
            <li>
              Tap the mic next to the box – for example <b>Delivery due</b>. The first time, your phone asks to use the microphone – tap <b>Allow</b>.
            </li>
            <li>Say the value, then stop talking. A bar at the bottom shows what Slay heard.</li>
            <li>The box fills in, and a message shows what was filled – e.g. “Delivery date: Sat 10 Oct 2026”.</li>
          </ol>
          <p className="small">What to say in each box:</p>
          <ul>
            <li>
              <b>Order came from:</b> “TikTok”, “इन्स्टाग्राम”
            </li>
            <li>
              <b>Phone:</b> the digits one by one – “nine eight four one…”, “नौ आठ चार एक…”
            </li>
            <li>
              <b>Product</b> (mic next to <b>Add item</b>): the name and colour – “black cotton kurta”, “रातो बनारसी साडी”
            </li>
            <li>
              <b>Size:</b> “42”, “बयालीस”, “medium”
            </li>
            <li>
              <b>Price, discount, amount paid:</b> “2500”, “पच्चीस सय”, “two thousand five hundred”
            </li>
            <li>
              <b>Delivery due / order date:</b> “October 10”, “अक्टोबर १०”, “tomorrow”, “भोलि”, “next Friday”
            </li>
            <li>
              <b>Payment (mic next to Payment):</b> “paid”, “partial”, “cash on delivery”; and the method – “cash”, “इसेवा”
            </li>
          </ul>
          <Tip>
            Speaking Nepali or English? Switch with the <b>नेपाली / English</b> buttons in the bar while it’s listening – Slay remembers your choice. Dates
            are in the English calendar: say “October 10”, not “असोज २४”.
          </Tip>
        </Topic>

        <Topic title="Update stock">
          <p>
            <b>New pieces arrived?</b> Go to <b>Stock</b>, tap the colour, then tap <b>+1</b>, <b>+5</b> or <b>+10</b>.
          </p>
          <p>
            <b>Counted the shelf?</b> Tap the colour, type the real number in <b>Set exact count</b>, and tap <b>Save count</b>.
          </p>
          <p>
            <b>Something new to sell?</b> Tap <b>Product</b> at the top of Stock, choose the type (Kurta, Sari, Lehenga…), type the name, how many you have, and
            each colour with its price. Tap <b>Save product</b>.
          </p>
          <Tip>You never need to take stock out by hand when you sell – saving an order does it. Cancelling an order puts the pieces back (you can switch that off if they were already cut).</Tip>
        </Topic>

        <Topic title="Check who has paid">
          <p>Every order shows a coloured label:</p>
          <ul className="badges-legend">
            <li>
              <span className="badge good">Paid in full</span> nothing left to collect.
            </li>
            <li>
              <span className="badge warn">Partial · Rs 1,500 due</span> paid some, still owes the amount shown.
            </li>
            <li>
              <span className="badge bad">COD / unpaid</span> pays on delivery.
            </li>
          </ul>
          <p>
            To see everyone who still owes money: <b>Orders</b> → tap <b>Money due</b> at the top.
          </p>
          <p>
            <b>Got paid?</b> Open the order → <b>Payment</b> → type the amount → choose how (cash, eSewa…) → <b>Save payment</b>. The label changes by itself.
          </p>
          <p>
            <b>Want her to pay by eSewa?</b> Open the order → <b>Send eSewa payment link</b> and send it in the chat. When she pays, the order turns{' '}
            <i>Paid in full</i> on its own.
          </p>
        </Topic>

        <Topic title="Send the parcel and the bill">
          <p>
            When the parcel goes out: open the order → <b>Mark sent</b> → type the tracking number if there is one.
          </p>
          <p>
            For the bill: open the order → <b>Invoice</b> → <b>Share</b> (to send it on WhatsApp or Instagram), <b>Save</b> (keep a copy) or <b>Print</b>.
          </p>
        </Topic>

        <Topic title="Cancel, return, exchange or refund (only when needed)">
          <p>Most orders never need this. It's there for the day a customer cancels or sends something back.</p>
          <ul>
            <li>
              <b>Cancel:</b> open the order → <b>Cancel order</b>. Choose whether the pieces go back into stock (switch it off if the kurta was already
              cut). If the customer had paid, you can give the money back right there, or later.
            </li>
            <li>
              <b>Return:</b> <b>Return / exchange</b> → <b>Return</b> → tap <b>+</b> for each piece that came back. Made-to-order pieces are not put back in
              stock unless you switch it on. Slay shows how much to give back.
            </li>
            <li>
              <b>Exchange:</b> same button → <b>Exchange</b> → choose the pieces that came back → <b>Add replacement</b> (another size, colour or product).
              If the new item costs more, the order shows what the customer still owes; if less, what to give back.
            </li>
            <li>
              <b>Refund:</b> when money is owed back the order shows <b>To give back</b> and a <b>Record refund</b> button (also on the Home screen). Enter
              the amount and how it was paid back. Your partner gets a notification for every refund.
            </li>
          </ul>
          <Tip>For a product that can be resold after a return, switch on <b>Can be returned and sold again</b> on the product – returned pieces then go back into stock by default.</Tip>
        </Topic>

        <Topic title="If something goes wrong">
          <ul>
            <li>Slay always says what happened and what to do – read the message at the bottom of the screen.</li>
            <li>
              A yellow <b>Offline</b> strip means no internet. You can still look at recent orders and stock, but saving waits until you’re back online.
            </li>
            <li>A mistake in an order? Open it and tap the pencil at the top right to change it.</li>
            <li>Still stuck? Take a screenshot and send it to whoever set Slay up for you.</li>
          </ul>
        </Topic>

        <Link to="/orders/new" className="btn primary block">
          <Icon name="plus" size={18} /> Try it: take an order
        </Link>
      </main>
    </>
  );
}

function Topic({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="card guide-topic" open={open}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="stack" style={{ gap: 10, marginTop: 10 }}>
        {children}
      </div>
    </details>
  );
}

const Tip = ({ children }: { children: ReactNode }) => <p className="guide-tip">{children}</p>;
