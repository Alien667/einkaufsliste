import logging
import os
from dotenv import load_dotenv

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger("uvicorn")

class EmailService:
    """
    Service for sending emails using Brevo SMTP.
    """

    def __init__(self):
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp-relay.brevo.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", 587))
        self.smtp_user = os.getenv("SMTP_USER")
        self.smtp_password = os.getenv("SMTP_PASSWORD")

    def _send_email(self, to_email: str, subject: str, body: str):
        # Debug Logging
        logger.info("==================================================")
        logger.info(f"DEBUG EMAIL: To: {to_email}")
        logger.info(f"DEBUG EMAIL: Subject: {subject}")
        logger.info(f"DEBUG EMAIL: Body: {body}")
        logger.info("==================================================")

        if not self.smtp_user or not self.smtp_password:
            logger.error("SMTP credentials not configured. Check your .env file.")
            raise ValueError("SMTP credentials missing.")

        msg = MIMEMultipart()
        msg['From'] = self.smtp_user
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        try:
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(msg['From'], to_email, msg.as_string())
            logger.info(f"Email successfully sent to {to_email}")
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            raise e

    async def send_verification_email(self, email: str, verification_link: str):
        """Sends an email for account verification."""
        subject = "Verifizierung Ihrer E-Mail-Adresse"
        body = f"Bitte klicken Sie auf den folgenden Link, um Ihre E-Mail-Adresse zu verifizieren:\n\n{verification_link}"
        
        import anyio
        await anyio.to_thread.run_sync(self._send_email, email, subject, body)

    async def send_password_reset_email(self, email: str, reset_link: str):
        """Sends an email for password reset."""
        subject = "Passwort zurücksetzen"
        body = f"Bitte klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen:\n\n{reset_link}"
        
        import anyio
        await anyio.to_thread.run_sync(self._send_email, email, subject, body)

# Singleton instance
email_service = EmailService()
