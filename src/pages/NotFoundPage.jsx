import { Link } from "react-router-dom";

const NotFoundPage = () => {
  return (
    <section>
      <h1>Сторінку не знайдено</h1>
      <Link to="/">Повернутися на головну</Link>
    </section>
  );
};

export default NotFoundPage;
