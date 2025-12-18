import React, { useEffect, useRef } from 'react';
import { SceneController } from '../babylon/SceneController';

interface Props {
  onControllerReady: (controller: SceneController) => void;
}

export const CanvasContainer: React.FC<Props> = ({ onControllerReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      const controller = new SceneController(canvasRef.current);
      onControllerReady(controller);
      
      // Handle resize explicitly if needed, but window listener is in controller
      
      return () => {
        controller.dispose();
      };
    }
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', outline: 'none' }} />;
};
