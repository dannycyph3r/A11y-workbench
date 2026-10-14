/** Small example sources offered in the Source code tab. Each contains deliberate defects. */

export const SAMPLE_JSX = `import { Search, X } from "lucide-react";

type Props = { clinic: string; slots: number; onBook: () => void };

export function BookingCard({ clinic, slots, onBook }: Props) {
  return (
    <section className="booking-card">
      <h3>{clinic}</h3>
      <img src="/clinic.jpg" />
      <p style={{ color: "#9aa5b1", fontSize: 14 }}>{slots} slots left today</p>
      <input type="search" className="search" />
      <button className="icon-only" onClick={onBook}>
        <Search aria-hidden="true" />
      </button>
      <div role="button" className="book" onClick={onBook}>
        Book now
      </div>
      <a href="/close" aria-lable="Close">
        <X aria-hidden="true" />
      </a>
    </section>
  );
}
`;

export const SAMPLE_CSS = `/* Booking widget styles */
.booking-card {
  background: #ffffff;
  border: 1px solid #e4e7eb;
}

.booking-card .hint {
  color: #a0aab4;
  background-color: #ffffff;
  font-size: 14px;
}

.badge {
  color: #ffffff;
  background-color: #2f9e44;
}

*:focus {
  outline: none;
}

.cta {
  color: #ffffff;
  background-color: #0b5cad;
}
`;

export const SAMPLE_HTML = `<form class="newsletter">
  <h3>Get clinic updates</h3>
  <input type="email" placeholder="Email">
  <select>
    <option>Weekly</option>
    <option>Monthly</option>
  </select>
  <button type="submit"><img src="/icons/send.svg"></button>
  <p style="color:#b0b0b0">We never share your address.</p>
</form>
`;
