export default function StudyPlaceholderPage({ title, description }) {
  return (
    <div className="study-placeholder">
      <div className="study-placeholder__card">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
