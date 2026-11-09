const stars = [1, 2, 3, 4, 5];

type RatingProps = {
  /** 1 to 5, or null when unrated. */
  value: number | null;
  /** Names the rated track in button labels. */
  label: string;
  disabled?: boolean;
  compact?: boolean;
  /** Called with the new rating, or null when the current rating is selected again. */
  onChange: (rating: number | null) => void;
};

export default function Rating({ value, label, disabled, compact, onChange }: RatingProps) {
  return (
    <div className={compact ? "rating rating-compact" : "rating"} role="group" aria-label={`Rating for ${label}`}
      data-rated={value !== null || undefined}>
      {stars.map((star) => {
        const current = star === value;
        return (
          <button key={star} type="button" disabled={disabled} aria-pressed={current}
            aria-label={current ? `Clear rating for ${label}` : `Rate ${label} ${star} ${star === 1 ? "star" : "stars"}`}
            title={current ? "Clear rating" : `${star} ${star === 1 ? "star" : "stars"}`}
            data-filled={value !== null && star <= value}
            onClick={() => onChange(current ? null : star)}>
            <span aria-hidden="true">★</span>
          </button>
        );
      })}
    </div>
  );
}
