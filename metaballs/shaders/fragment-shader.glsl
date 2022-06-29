function getFragmentShader() {
precision mediump float;

#define NR_OF_METABALLS 5

// The threshold charge for a meta surface
#define TRESHOLD 0.9

// A small number that you want to use to decide if the ray is close enough to surface
#define EPSILON 0.0000001

// How many steps of marching
#define MARCHING_STEPS 1000

uniform mat4 invView;
uniform mat4 invProj;
uniform vec4 ray00;
uniform vec4 ray01;
uniform vec4 ray10;
uniform vec4 ray11;
uniform vec3 u_CamPos;
uniform vec4 u_Metaballs;
uniform vec2 res;

// point light
uniform vec3 light;

uniform vec4 metaballs[NR_OF_METABALLS];
uniform vec3 diffuseColors[NR_OF_METABALLS];

struct Ray
{
  vec3 origin;
  vec3 direction;
  vec3 currPos;
  float depth;
};

struct Material
{
  vec3 diffuse;
  float reflectance;
};

struct Hit
{
  vec3 position;
  vec3 normal;
  float t;
  Material material;
};

struct Blob
{
  // coords + radius
  vec3 center;
  float radius;
  Material material;
};

Ray initRay()
{
  vec2 pos = vec2(gl_FragCoord.xy);
  vec2 interp = pos / res;

  vec4 rayDirection = mix(
      mix(ray00, ray01, interp.y), // left corners together
      mix(ray10, ray11, interp.y), // right corners together
      interp.x // join new interpolated rays into a final ray
  );
  rayDirection = vec4(rayDirection.xyz, 1.0);
  rayDirection = normalize(rayDirection);

  Ray r;
  r.origin = -u_CamPos;
  r.direction = rayDirection.xyz;
  return r;
}

Blob blobs[NR_OF_METABALLS];

// initializes the scene
void initScene()
{
  for (int i = 0; i < NR_OF_METABALLS; i++)
  {
    // set the center, radius and material of the blobs
    blobs[i].center = vec3(vec4(metaballs[i].xyz, 1.0));
    blobs[i].radius = metaballs[i].r;
    blobs[i].material.diffuse = diffuseColors[i];
    blobs[i].material.reflectance = 0.2;
  }
}

float sdMetaBalls( vec3 pos, out int hitIndex )
{
    float m = 0.0;
    float p = 0.0;
    float dmin = 1e20;
    int counter = 0;
    float h = 1.0; // track Lipschitz constant
    for( int i = 0; i < NR_OF_METABALLS; i++ )
    {
        /* Bounding sphere for ball */

        // distance between current ray and current blob
        float db = length( blobs[i].center - pos );

        // if the distance is shorter than current blob's radius
        if( db < blobs[i].radius )
        {
            float x = db / blobs[i].radius;
            p += 1.0 - x * x * x * ( x * (x * 6.0 - 15.0) + 10.0);
            m += 1.0;
            float h = max(h, 0.133 * blobs[i].radius);
            counter++;
         }
         /* Bouncing sphere distance */
         else
         {
           // the ray is still out of current blob's boundary
           // update dmin with the closest distance between current ray and the surface of blobs
           //dmin = min(dmin, db - blobs[i].radius);
           dmin = db - blobs[i].radius;
         }
     }
     hitIndex = counter;

     // add just big enough to push the ray into the blob when the ray hit the bounding sphere.
     float d = dmin + 0.1;
     if(m > 0.5)
     {
         d = h * (TRESHOLD - p);
     }

     // return the updated distance for the next marching step
     return d;
}

// Distance Field function. it's also called Distance Map or Distance Transform
float map( in vec3 p , out int hitIndex)
{
  return sdMetaBalls( p, hitIndex );
}

vec3 calcNormal( in vec3 pos , out int hitIndex)
{
  vec3 eps = vec3(TRESHOLD, 0.0, 0.0);
  return normalize(vec3(
       map(pos + eps.xyy, hitIndex) - map(pos - eps.xyy, hitIndex),
       map(pos + eps.yxy, hitIndex) - map(pos - eps.yxy, hitIndex),
       map(pos + eps.yyx, hitIndex) - map(pos - eps.yyx, hitIndex)
  ));
}

vec2 intersect( in vec3 ro, in vec3 rd, out int hitIndex )
{
  // Maximum distance - if the ray go further than this, we'll assume there's nothing
  float maxd = 1000.0;

  // Marching step size from the distance field - the closest distance between the current ray position and surface
  float h = EPSILON * 2.0;

  // Total travel distance of the ray - the distance between ray origin and surface
  float t = 0.0;

  // How many steps of marching - the more you iterate, the more precision you will have. But also the more computation cost.
  for(int i = 0; i < MARCHING_STEPS; i++)
  {
      // When the ray is close enough to the surface or the total travel distance is bigger than maximum distance then break the loop
      if( h < EPSILON || t > maxd ) break;

      // Update the total travel distance with the updated marching distance from previous loop
      t += h;

      // Update the marching distance from the distance field
      // ro + rd * t - current position of your ray
      // map(ray) - return the closest distance between the ray and the the scene
      h = map( ro + rd * t, hitIndex );
  }

  // Tells whether the ray is out of the max or not
  float m = 1.0;

  // update m if the ray travels further than the maximum distance. This value will be used to decide whether we render background or metaball in this example
  if( t > maxd )
  {
      m = -1.0;
  }

  return vec2(t, m);
}

vec3 colorForIntersection(in vec3 rd, in vec3 pos, in vec3 normal, in vec3 light_pos, in vec3 color)
{
	vec3 light_dir = normalize(light_pos + pos);
	float shininess = 15.0;
	float lambertian = max(dot(light_dir, normal), 0.0);
	float specular = 0.0;

	if (lambertian > 0.0)
    {
		vec3 refl_dir = reflect(-light_dir, normal);
		float spec_angle = max(dot(refl_dir, -rd), 0.0);
		specular = pow(spec_angle, shininess/4.0);
	}

	return lambertian * color + specular;
}

void main()
{
  // create the primary ray
  Ray ray = initRay();
  vec3 ro = ray.origin;
  vec3 rd = ray.direction;

  // create the scene
  initScene();

  // background
  vec3 backgroundColor = vec3(0.0, 0.0, 0.0);
  vec3 final_color = vec3(0);

  // raymarch
  int hitIndex = 0;
  vec2 hit = intersect(ro, rd, hitIndex);

  // coloring
  if(hit.y > -1.0)
  {
    vec3 pos = ro + hit.x * rd;
    vec3 nor = calcNormal(pos, hitIndex);
    vec3 color;

    if (hitIndex == 0)
    {
        color = blobs[0].material.diffuse;
    }
    else if (hitIndex == 1)
    {
        color = blobs[1].material.diffuse;
    }
    else if (hitIndex == 2)
    {
        color = blobs[2].material.diffuse;
    }
    else if (hitIndex == 3)
    {
        color = blobs[3].material.diffuse;
    }
    else if (hitIndex == 4)
    {
        color = blobs[4].material.diffuse;
    }
    else
    {
        color = vec3(0.2, 0.2, 0.2);
    }

	final_color = colorForIntersection(rd, pos, nor, light, color);
  }
  else
  {
    final_color = backgroundColor;
  }

  gl_FragColor = vec4(final_color, 1.0);
}
}