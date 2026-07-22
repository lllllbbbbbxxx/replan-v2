import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Replan — 把大任务变成今天能做的一步",
  description: "输入目标和截止日期，自动拆解并安排未来七天的行动计划。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
