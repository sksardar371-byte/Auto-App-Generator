import { Link } from "react-router-dom";

export default function Navbar() {
  return (
    <nav>
      <Link to="/signin">Sign In</Link>
      <Link to="/signup">Sign Up</Link>
    </nav>
  );
}
