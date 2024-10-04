import * as THREE from "three";
import { createRingMesh } from "./rings";
import { createPath } from "./path";
import { loadTexture } from "./textures";
import { Label } from "./label";
import { PointOfInterest } from "./label";

export interface Body {
  name: string;
  radius: number;
  distance: number;
  period: number;
  daylength: number;
  textures: TexturePaths;
  type: string;
  orbits?: string;
  labels?: PointOfInterest[];
  tilt: number;
  traversable: boolean;
  offset?: number;
  innerRadius: number;
  outerRadius: number;
  eccentricity: number;
  inclination: number;
  semiMajorAxis: number;
  argPerigee: number;
  raan: number;

}

interface TexturePaths {
  map: string;
  bump?: string;
  atmosphere?: string;
  atmosphereAlpha?: string;
  specular?: string;
}

interface Atmosphere {
  map?: THREE.Texture;
  alpha?: THREE.Texture;
}

const timeFactor = 8 * Math.PI * 2; // 1s real-time => 8h simulation time

// TODO Make something happen here properly!

const degreesToRadians = (degrees: number): number => {
  return (Math.PI * degrees) / 180;
};

export class PlanetaryObject {
  radius: number; // in km
  distance: number; // in million km
  innerRadius: number; // in km
  eccentricity: number;
  outerRadius: number; // in km
  period: number; // in days
  daylength: number; // in hours
  orbits?: string;
  type: string;
  tilt: number; // degrees
  mesh: THREE.Mesh;
  path?: THREE.Line;
  rng: number;
  map: THREE.Texture;
  bumpMap?: THREE.Texture;
  specularMap?: THREE.Texture;
  atmosphere: Atmosphere = {};
  labels: Label;
  inclination: number;
  semiMajorAxis: number;
  semiLatusRectum: number;
  argPerigee: number;
  raan: number;

  constructor(body: Body) {
    const { radius, distance, period, daylength, orbits, type, tilt, innerRadius, outerRadius, eccentricity, inclination, semiMajorAxis, argPerigee, raan } = body;

    this.radius = radius / 1000000;
    this.distance = distance;
    this.period = period;
    this.daylength = daylength;
    this.orbits = orbits;
    this.type = type;
    this.tilt = degreesToRadians(tilt);
    this.rng = body.offset ?? Math.random() * 2 * Math.PI;
    this.innerRadius = innerRadius / 1000000;
    this.outerRadius = outerRadius / 1000000;
    this.eccentricity = eccentricity;
    this.inclination = inclination * 0.01745329;
    this.semiMajorAxis = semiMajorAxis;
    this.argPerigee = argPerigee * 0.01745329;
    this.raan = raan * 0.01745329;
    this.semiLatusRectum = this.semiMajorAxis * (1 - this.eccentricity ^ 2);

    this.loadTextures(body.textures);

    this.mesh = this.createMesh();

    if (this.orbits) {
      this.path = createPath(this.distance);
    }

    if (this.atmosphere.map) {
      this.mesh.add(this.createAtmosphereMesh());
    }

    this.initLabels(body.labels);
  }

  /**
   * Creates label objects for each point-of-interest.
   * @param labels - List of labels to display.
   */
  private initLabels = (labels?: PointOfInterest[]) => {
    this.labels = new Label(this.mesh, this.radius);

    if (labels) {
      labels.forEach((poi) => {
        this.labels.createPOILabel(poi);
      });
    }
  };

  /**
   * Prepare and load textures.
   * @param textures - Object of texture paths to load.
   */
  private loadTextures(textures: TexturePaths) {
    this.map = loadTexture(textures.map);
    if (textures.bump) {
      this.bumpMap = loadTexture(textures.bump);
    }
    if (textures.specular) {
      this.specularMap = loadTexture(textures.specular);
    }
    if (textures.atmosphere) {
      this.atmosphere.map = loadTexture(textures.atmosphere);
    }
    if (textures.atmosphereAlpha) {
      this.atmosphere.alpha = loadTexture(textures.atmosphereAlpha);
    }
  }

  /**
   * Creates the main mesh object with textures.
   * @returns celestial body mesh.
   */
  private createMesh = () => {
    if (this.type === "ring") {
      return createRingMesh(this.map, this.innerRadius, this.outerRadius);
    }

    const geometry = new THREE.SphereGeometry(this.radius, 64, 64);
    let material;
    if (this.type === "star") {
      material = new THREE.MeshBasicMaterial({
        map: this.map,
        lightMapIntensity: 2,
        toneMapped: false,
        color: new THREE.Color(2.5, 2.5, 2.5),
      });
    } else {
      material = new THREE.MeshPhongMaterial({
        map: this.map,
        shininess: 5,
        toneMapped: true,
      });

      if (this.bumpMap) {
        material.bumpMap = this.bumpMap;
        material.bumpScale = this.radius / 50;
      }

      if (this.specularMap) {
        material.specularMap = this.specularMap;
      }
    }

    const sphere = new THREE.Mesh(geometry, material);
    // sphere.rotation.x = this.tilt; // The tilt that isn't a part of the keplerian mechanics
    sphere.castShadow = true;
    sphere.receiveShadow = true;

    return sphere;
  };

  /**
   * Creates the atmosphere mesh object with textures.
   * @returns atmosphere mesh.
   */
  private createAtmosphereMesh = () => {
    const geometry = new THREE.SphereGeometry(this.radius + 0.0005, 64, 64);

    const material = new THREE.MeshPhongMaterial({
      map: this.atmosphere?.map,
      transparent: true,
    });

    if (this.atmosphere.alpha) {
      material.alphaMap = this.atmosphere.alpha;
    }

    const sphere = new THREE.Mesh(geometry, material);
    sphere.receiveShadow = true;
    sphere.rotation.x = this.tilt;
    return sphere;
  };

  private getRotation = (elapsedTime: number) => {
    // timeFactor converts the angle
    // Non Keplerian
    return this.daylength ? (elapsedTime * timeFactor) / this.daylength : 0;
  };

  private getOrbitRotation = (elapsedTime: number) => {
    // Keplerian
    return this.daylength ? (elapsedTime * timeFactor) / (this.period * 24) : 0;
  };

  private propagate = (elapsedTime: number) => {
    /// ORBITL PROPAGATOR
    const mValue = (timeFactor / (this.period * 24)) * ((elapsedTime * timeFactor) % (this.period * 24)); // MeanAnomaly
    var eA = 0;
    const tol = 0.0001;  // tolerance
    var eAo = mValue;  // initialize eccentric anomaly with mean anomaly
    var ratio = 1;     // set ratio higher than the tolerance
    while (Math.abs(ratio) > tol) {
      var f_E = eAo - this.eccentricity * Math.sin(eAo) - mValue;
      var f_Eprime = 1 - this.eccentricity * Math.cos(eAo);
      ratio = f_E / f_Eprime;
      if (Math.abs(ratio) > tol) {
        eAo = eAo - ratio;
      }
      else
        eA = eAo;
    }
    const tAnomaly = 2 * Math.atan(Math.sqrt((1 + this.eccentricity) / (1 - this.eccentricity)) * Math.tan(eA / 2)); // trueAnomaly
    const r = this.semiLatusRectum / (1 + this.eccentricity * Math.cos(tAnomaly));  // Compute radial distance.

    const x = r * (Math.cos(this.argPerigee + tAnomaly) * Math.cos(this.raan) - Math.cos(this.inclination) * Math.sin(this.argPerigee + tAnomaly) * Math.sin(this.raan));
    const y = r * (Math.cos(this.argPerigee + tAnomaly) * Math.sin(this.raan) + Math.cos(this.inclination) * Math.sin(this.argPerigee + tAnomaly) * Math.cos(this.raan));
    const z = r * (Math.sin(this.argPerigee + tAnomaly) * Math.sin(this.inclination));

    return [x, y, z];
  }

  // private trueToEccentricAnomaly(f) {
  //   // http://mmae.iit.edu/~mpeet/Classes/MMAE441/Spacecraft/441Lecture19.pdf slide 7 
  //   var eccentricAnomaly = 2 * Math.atan(Math.sqrt((1 - this.eccentricity) / (1 + this.eccentricity)) * Math.tan(f / 2));
  //   return eccentricAnomaly;
  // }

  /**
   * Updates orbital position and rotation.
   * @param elapsedTime - number of seconds elapsed.
   */
  tick = (elapsedTime: number) => {

    const rotation = this.getRotation(elapsedTime);
    const orbitRotation = this.getOrbitRotation(elapsedTime);
    const orbit = orbitRotation + this.rng;

    if (this.eccentricity > 0) {
      // const 
      // console.log("We got orbit!");
      // console.log(this.eccentricity);
      const [tx, ty, tz] = this.propagate(elapsedTime);
      this.mesh.position.x = tx;
      this.mesh.position.y = tz;
      this.mesh.position.z = ty;
      // console.log(tx, ty, tz);
    }

    else {
      // Circular rotation around orbit.
      this.mesh.position.x = Math.sin(orbit) * this.distance;
      // this.mesh.position.y = Math.sin(orbit) * this.distance;
      this.mesh.position.z = Math.cos(orbit) * this.distance;
    }



    if (this.type === "ring") {
      this.mesh.rotation.z = rotation;
    } else {
      this.mesh.rotation.y = rotation;
    }
  };

  /**
   * @returns the minimum orbital control camera distance allowed.
   */
  getMinDistance = (): number => {
    return this.radius * 0.5;
  };
}
