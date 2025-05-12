import React from 'react';

interface CustomLockIconProps extends React.SVGProps<SVGSVGElement> {}

export const CustomLockIcon: React.FC<CustomLockIconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M9.75 8.25C9.75 7.00736 10.7574 6 12 6C13.2426 6 14.25 7.00736 14.25 8.25V9.75H9.75V8.25ZM8.25 9.75V8.25C8.25 6.17893 9.92893 4.5 12 4.5C14.0711 4.5 15.75 6.17893 15.75 8.25V9.75H17.25L18 10.5V18.75L17.25 19.5H6.75L6 18.75V10.5L6.75 9.75H8.25ZM7.5 18V11.25H16.5V18H7.5Z" />
  </svg>
); 