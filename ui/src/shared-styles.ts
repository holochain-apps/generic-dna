import { css, unsafeCSS } from "lit";
import styles from "./index.css?inline";

export const sharedStyles = css`${unsafeCSS(styles)}`;
