export default function PagePlaceholder({ title, description }) {
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
    </section>
  );
}