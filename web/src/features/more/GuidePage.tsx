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
              <b>Home</b> – today’s sales, money still to collect, orders to send.
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
          <ol>
            <li>
              Tap the pink <b>+</b>. The voice box is at the top.
            </li>
            <li>
              Choose <b>नेपाली</b> or <b>English</b>.
            </li>
            <li>
              Tap the round <b>mic</b> button and say the order the way you’d tell a friend. The first time, your phone asks to use the microphone – tap{' '}
              <b>Allow</b>.
            </li>
            <li>
              Tap the mic again to stop. Slay fills in the form for you.
            </li>
            <li>
              <b>Check everything</b>, fix anything it misheard, then tap <b>Save order</b>.
            </li>
          </ol>
          <p className="small">You can say, for example:</p>
          <blockquote>“कालो कुर्ता दुई वटा, पच्चीस सय, आधा पेड इसेवा, भोलि डेलिभरी, टिकटक बाट, नाम सीता”</blockquote>
          <blockquote>“two black kurta size 42, 2500 each, paid 2000 by eSewa, delivery tomorrow, from Instagram”</blockquote>
          <Tip>Speak in a quiet place. You can also type the same sentence into the box and tap <b>Fill the form</b>.</Tip>
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
          <Tip>You never need to take stock out by hand when you sell – saving an order does it. Cancelling an order puts the pieces back.</Tip>
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
