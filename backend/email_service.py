import logging

logger = logging.getLogger(__name__)

class EmailService:
    """
    Service for sending emails. 
    Currently implemented as a logger for development purposes.
    """

    async def send_verification_email(self, email: str, verification_link: str):
        # In a real implementation, you would use smtplib or fastapi-mail here.
        logger.info(f"--- [MOCK EMAIL SENT] ---")
        logger.info(f"To: {email}")
        logger.info(f"Subject: Verify your email address")
        logger.info(f"Body: Please click the link to verify your email: {verification_link}")
        logger.info(f"-------------------------")
        # For local development, we print to console so the developer can see the link.
        print(f"\n[MOCK EMAIL] To: {email}\nLink: {verification_link}\n")

    async def send_password_reset_email(self, email: str, reset_link: str):
        logger.info(f"--- [MOCK EMAIL SENT] ---")
        logger.info(f"To: {email}")
        logger.info(f"Subject: Password Reset Request")
        logger.info(f"Body: Please click the link to reset your password: {reset_link}")
        logger.info(f"-------------------------")
        print(f"\n[MOCK EMAIL] To: {email}\nLink: {reset_link}\n")

# Singleton instance
email_service = EmailService()
