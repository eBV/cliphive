import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: {
        params: { scope: "read:user user:email" },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      // Fallback: use GitHub login as email identifier if email is private
      if (!session.user.email && token.login) {
        session.user.email = `${token.login}@github.local`;
      }
      return session;
    },
    async jwt({ token, profile }) {
      if (profile) {
        // Store GitHub login for fallback
        token.login = (profile as { login?: string }).login;
      }
      return token;
    },
  },
});
