import type { NormalizedQuery, Offer } from "@/types";
import type { PriceProvider } from "./types";

// Deterministic sample data so the app is fully demoable with zero paid API keys.
// Offers are picked by matching keywords in the query/title/category against a
// small set of canned product categories; anything unmatched falls back to a
// generic "electronics" style set so results are never empty.

interface MockCategory {
  id: string;
  keywords: string[];
  offers: Offer[];
}

const MOCK_CATEGORIES: MockCategory[] = [
  {
    id: "headphones",
    keywords: ["headphone", "earbud", "earphone", "airpods", "wh-1000", "headset"],
    offers: [
      {
        store: "Amazon",
        price: 278.0,
        url: "https://www.amazon.com/s?k=wireless+headphones",
        shipping: "Free Prime shipping",
        rating: 4.7,
      },
      {
        store: "Best Buy",
        price: 299.99,
        url: "https://www.bestbuy.com/site/searchpage.jsp?st=wireless+headphones",
        shipping: "Free shipping",
        rating: 4.6,
      },
      {
        store: "Walmart",
        price: 289.0,
        url: "https://www.walmart.com/search?q=wireless+headphones",
        shipping: "$5.99 shipping",
        rating: 4.5,
      },
      {
        store: "MediaMarkt (DE)",
        price: 259.0,
        originalCurrency: "EUR",
        originalPrice: 239.0,
        url: "https://www.mediamarkt.de/de/search.html?query=wireless+headphones",
        shipping: "Ships in 5-7 days",
        rating: 4.4,
      },
      {
        store: "Target",
        price: 309.99,
        url: "https://www.target.com/s?searchTerm=wireless+headphones",
        shipping: "Free 2-day shipping",
        rating: 4.5,
      },
    ],
  },
  {
    id: "sneakers",
    keywords: ["shoe", "sneaker", "trainer", "running shoe", "nike", "adidas", "jordan"],
    offers: [
      {
        store: "Foot Locker",
        price: 129.99,
        url: "https://www.footlocker.com/search?query=sneakers",
        shipping: "Free shipping over $50",
        rating: 4.3,
      },
      {
        store: "Amazon",
        price: 119.95,
        url: "https://www.amazon.com/s?k=sneakers",
        shipping: "Free Prime shipping",
        rating: 4.5,
      },
      {
        store: "Nike.com",
        price: 140.0,
        url: "https://www.nike.com/w/shoes",
        shipping: "Free member shipping",
        rating: 4.6,
      },
      {
        store: "JD Sports (UK)",
        price: 137.5,
        originalCurrency: "GBP",
        originalPrice: 109.99,
        url: "https://www.jdsports.co.uk/search/?q=sneakers",
        shipping: "International shipping $12",
        rating: 4.2,
      },
    ],
  },
  {
    id: "coffee-maker",
    keywords: ["coffee", "espresso", "keurig", "nespresso", "brewer", "percolator"],
    offers: [
      {
        store: "Williams Sonoma",
        price: 189.95,
        url: "https://www.williams-sonoma.com/search/results.html?words=coffee+maker",
        shipping: "Free shipping",
        rating: 4.6,
      },
      {
        store: "Amazon",
        price: 164.99,
        url: "https://www.amazon.com/s?k=coffee+maker",
        shipping: "Free Prime shipping",
        rating: 4.7,
      },
      {
        store: "Bed Bath & Beyond",
        price: 179.99,
        url: "https://www.bedbathandbeyond.com/store/s/coffee+maker",
        shipping: "$6.99 shipping",
        rating: 4.4,
      },
      {
        store: "Saturn (DE)",
        price: 172.3,
        originalCurrency: "EUR",
        originalPrice: 159.0,
        url: "https://www.saturn.de/de/search.html?query=kaffeemaschine",
        shipping: "Ships in 3-5 days",
        rating: 4.3,
      },
      {
        store: "Target",
        price: 169.99,
        url: "https://www.target.com/s?searchTerm=coffee+maker",
        shipping: "Free 2-day shipping",
        rating: 4.5,
      },
    ],
  },
];

const GENERIC_OFFERS: Offer[] = [
  {
    store: "Amazon",
    price: 49.99,
    url: "https://www.amazon.com/s?k=product",
    shipping: "Free Prime shipping",
    rating: 4.4,
  },
  {
    store: "Walmart",
    price: 44.5,
    url: "https://www.walmart.com/search?q=product",
    shipping: "$4.99 shipping",
    rating: 4.2,
  },
  {
    store: "eBay",
    price: 41.0,
    url: "https://www.ebay.com/sch/i.html?_nkw=product",
    shipping: "Free shipping",
    rating: 4.1,
  },
  {
    store: "Target",
    price: 52.99,
    url: "https://www.target.com/s?searchTerm=product",
    shipping: "Free 2-day shipping",
    rating: 4.3,
  },
];

/** Exported for unit tests: pick which canned category a query maps to. */
export function selectMockCategory(query: NormalizedQuery): MockCategory | null {
  const haystack = [query.query, query.title, query.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const category of MOCK_CATEGORIES) {
    if (category.keywords.some((kw) => haystack.includes(kw))) {
      return category;
    }
  }
  return null;
}

function cloneOffers(offers: Offer[]): Offer[] {
  return offers.map((o) => ({ ...o }));
}

export class MockPriceProvider implements PriceProvider {
  readonly name = "mock" as const;

  async search(query: NormalizedQuery): Promise<Offer[]> {
    const category = selectMockCategory(query);
    const offers = cloneOffers(category ? category.offers : GENERIC_OFFERS);
    return offers.sort((a, b) => a.price - b.price);
  }
}

export const mockProvider = new MockPriceProvider();
